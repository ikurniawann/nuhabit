package mail

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"nuhabit/backend/internal/platform/database"
)

// configTTL is how long a loaded configuration is reused before the settings
// table is read again. Save handlers call Invalidate for an immediate reload.
const configTTL = 30 * time.Second

// retryBatch bounds one run of the retry job.
const retryBatch = 50

// Service is the mailer port: configuration, the provider behind it, the log
// and the retries. One per process is enough; tests build one on a
// transaction with a fake provider.
type Service struct {
	db     database.DB
	getenv func(string) string
	log    *slog.Logger
	now    func() time.Time
	// Providers builds the provider for a configuration; tests replace it.
	Providers func(Config) (Provider, error)
	// HTTP is the client of the HTTP providers; nil uses a 20 s default.
	HTTP *http.Client

	mu       sync.Mutex
	cachedAt time.Time
	cached   Config
	graph    *Graph
}

// New builds the service on a pool or a transaction.
func New(db database.DB, getenv func(string) string, log *slog.Logger, now func() time.Time) *Service {
	if getenv == nil {
		getenv = os.Getenv
	}
	if log == nil {
		log = slog.Default()
	}
	if now == nil {
		now = time.Now
	}
	s := &Service{db: db, getenv: getenv, log: log, now: now}
	s.Providers = s.defaultProvider
	return s
}

// Config returns the merged configuration, reloaded after configTTL.
func (s *Service) Config(ctx context.Context) (Config, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.cachedAt.IsZero() && s.now().Sub(s.cachedAt) < configTTL {
		return s.cached, nil
	}
	cfg, err := Load(ctx, s.db, s.getenv)
	if err != nil {
		return Config{}, err
	}
	s.cached, s.cachedAt = cfg, s.now()
	return cfg, nil
}

// Invalidate forgets the cached configuration (after a settings save).
func (s *Service) Invalidate() {
	s.mu.Lock()
	s.cachedAt = time.Time{}
	s.mu.Unlock()
}

// Configured reports whether a send can go out right now.
func (s *Service) Configured(ctx context.Context) bool {
	cfg, err := s.Config(ctx)
	return err == nil && cfg.Configured()
}

// defaultProvider is the real provider of a configuration. The Graph client
// is kept while its credentials stay the same so its token cache survives
// configuration reloads.
func (s *Service) defaultProvider(cfg Config) (Provider, error) {
	switch cfg.Resolved() {
	case ProviderResend:
		return &Resend{APIKey: cfg.ResendAPIKey, Client: s.HTTP}, nil
	case ProviderGraph:
		s.mu.Lock()
		defer s.mu.Unlock()
		if s.graph == nil || !s.graph.Same(cfg) {
			s.graph = &Graph{TenantID: cfg.TenantID, ClientID: cfg.ClientID, ClientSecret: cfg.ClientSecret, Mailbox: cfg.Mailbox(),
				Client: s.HTTP, Now: s.now}
		}
		return s.graph, nil
	case ProviderSMTP:
		return &SMTP{Host: cfg.SMTPHost, Port: cfg.SMTPPort, Username: cfg.SMTPUser, Password: cfg.SMTPPassword}, nil
	}
	return nil, ErrNotConfigured
}

// Result is the outcome of Send.
type Result struct {
	// ID is the log row; empty when the message could not be logged.
	ID        string
	Provider  string
	MessageID string
	// Status is sent, queued (a transient failure the job retries) or failed.
	Status string
	// Err is the provider's error, verbatim, when the message did not go out.
	Err error
}

// Sent reports whether the provider accepted the message.
func (r Result) Sent() bool { return r.Status == StatusSent }

// ready returns the current configuration and its provider, or why nothing
// can be sent.
func (s *Service) ready(ctx context.Context) (Config, Provider, error) {
	cfg, err := s.Config(ctx)
	if err != nil {
		return cfg, nil, err
	}
	provider, err := s.Providers(cfg)
	return cfg, provider, err
}

// Send logs m and tries to deliver it once. A transient failure leaves the
// row queued for the retry job (unless m.NoRetry); the caller gets the
// provider's error either way.
func (s *Service) Send(ctx context.Context, m Message) Result {
	cfg, provider, err := s.ready(ctx)
	if err != nil {
		return Result{Err: err}
	}
	m, err = s.prepare(m, cfg)
	if err != nil {
		return Result{Err: err}
	}
	id, err := s.insert(ctx, m, provider.Name())
	if err != nil {
		return Result{Err: err}
	}
	return s.attempt(ctx, id, m, provider)
}

// prepare fills the sender from the configuration and checks the recipient.
// The Microsoft providers send from the configured mailbox whatever the
// caller asked, because Exchange rejects other From addresses.
func (s *Service) prepare(m Message, cfg Config) (Message, error) {
	m.To = strings.TrimSpace(m.To)
	if !strings.Contains(m.To, "@") {
		return m, fmt.Errorf("alamat penerima tidak valid: %q", m.To)
	}
	if m.From == "" || cfg.Resolved() != ProviderResend {
		m.From = cfg.SenderAddress()
	}
	if m.FromName == "" {
		m.FromName = cfg.FromName
	}
	if m.From == "" {
		return m, errors.New("alamat pengirim belum diatur: isi From di Settings → Integrasi → Email")
	}
	return m, nil
}

// attempt sends once and records the outcome.
func (s *Service) attempt(ctx context.Context, id string, m Message, provider Provider) Result {
	messageID, sendErr := provider.Send(ctx, m)
	status, err := s.recordAttempt(ctx, id, provider.Name(), messageID, sendErr)
	if err != nil {
		s.log.ErrorContext(ctx, "[mail] log update failed", "id", id, "error", err)
		if sendErr == nil {
			status = StatusSent
		} else {
			status = StatusFailed
		}
	}
	if sendErr != nil {
		s.log.WarnContext(ctx, "[mail] send failed", "id", id, "provider", provider.Name(), "status", status, "error", sendErr)
	}
	return Result{ID: id, Provider: provider.Name(), MessageID: messageID, Status: status, Err: sendErr}
}

// RetryDue is the integrations.mail-retry job: it sends every queued row
// whose wait is over, up to retryBatch per run.
func (s *Service) RetryDue(ctx context.Context, now time.Time) error {
	ids, err := s.due(ctx, now, retryBatch)
	if err != nil || len(ids) == 0 {
		return err
	}
	cfg, provider, err := s.ready(ctx)
	if err != nil {
		return err
	}
	for _, id := range ids {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		m, err := s.message(ctx, id)
		if err != nil {
			return err
		}
		if m, err = s.prepare(m, cfg); err != nil {
			if _, recErr := s.recordAttempt(ctx, id, provider.Name(), "", err); recErr != nil {
				return recErr
			}
			continue
		}
		s.attempt(ctx, id, m, provider)
	}
	return nil
}

// ErrNotResendable is returned for a row that must not be sent again.
var ErrNotResendable = errors.New("kode OTP tidak bisa dikirim ulang; minta member meminta kode baru")

// Resend sends a logged message again now and reports the outcome on the
// same row. Sign-in codes are refused.
func (s *Service) Resend(ctx context.Context, id string) (Result, error) {
	entry, err := s.Get(ctx, id)
	if err != nil {
		return Result{}, err
	}
	if entry == nil {
		return Result{}, nil
	}
	if entry.Kind == "otp" {
		return Result{}, ErrNotResendable
	}
	cfg, provider, err := s.ready(ctx)
	if err != nil {
		return Result{}, err
	}
	m, err := s.message(ctx, id)
	if err != nil {
		return Result{}, err
	}
	if m, err = s.prepare(m, cfg); err != nil {
		return Result{}, err
	}
	if err := s.reopen(ctx, id); err != nil {
		return Result{}, err
	}
	return s.attempt(ctx, id, m, provider), nil
}
