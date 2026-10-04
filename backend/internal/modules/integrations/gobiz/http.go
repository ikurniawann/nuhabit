// Package gobiz ports the GoBiz / GoFood integration settings and webhook:
// frontend/src/app/api/settings/gobiz (GET, PUT, POST actions) and
// POST /api/integrations/gobiz/webhook/{token}, with lib/gobiz. The
// cashier's GoFood order actions live in possales/gofood. The public image
// converter /api/public/gofood-image/{file} is in image.go.
package gobiz

import (
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"time"

	"nuhabit/backend/internal/modules/integrations/gobiz/domain"
	"nuhabit/backend/internal/modules/integrations/internal/appsettings"
	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/database"
	gobizapi "nuhabit/backend/internal/platform/gobiz"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/iam"
	"nuhabit/backend/internal/platform/module"
	"nuhabit/backend/internal/platform/validate"
)

// Guard is the IAM check the settings routes need (*auth.Service).
type Guard interface {
	RequireMenuPrefix(r *http.Request, prefixes ...string) (*auth.User, error)
}

// Handler serves the routes of this package.
type Handler struct {
	svc   *Service
	guard Guard
	// appURL is NEXT_PUBLIC_APP_URL (or NEXT_PUBLIC_BASE_URL); "" falls back
	// to the request origin.
	appURL string
}

// New builds the handler on the pool with one GoBiz client per process
// (one token cache, like the TS module).
func New(deps module.Deps, p Ports) *Handler {
	appURL := strings.TrimSpace(os.Getenv("NEXT_PUBLIC_APP_URL"))
	if appURL == "" {
		appURL = strings.TrimSpace(os.Getenv("NEXT_PUBLIC_BASE_URL"))
	}
	return NewHandler(deps.DB, deps.Auth, p, gobizapi.NewClient(nil, nil), deps.Now, deps.Log, appURL)
}

// NewHandler builds the handler on any pool or transaction; tests pass a
// rolled-back transaction and a client aimed at an httptest.Server. nil
// now/log take time.Now and slog.Default.
func NewHandler(db database.DB, guard Guard, p Ports, api *gobizapi.Client, now func() time.Time, log *slog.Logger, appURL string) *Handler {
	if now == nil {
		now = time.Now
	}
	if log == nil {
		log = slog.Default()
	}
	return &Handler{svc: &Service{db: db, p: p, api: api, now: now, log: log}, guard: guard, appURL: appURL}
}

// Routes lists the routes of this package.
func (h *Handler) Routes() []module.Route {
	return []module.Route{
		{Pattern: "GET /api/settings/gobiz", Handler: httpx.Handle(h.getSettings)},
		{Pattern: "PUT /api/settings/gobiz", Handler: httpx.Handle(h.putSettings)},
		{Pattern: "POST /api/settings/gobiz/actions", Handler: httpx.Handle(h.action)},
		{Pattern: "POST /api/integrations/gobiz/webhook/{token}", Handler: httpx.Handle(h.webhook)},
		{Pattern: "GET /api/public/gofood-image/{file}", Handler: http.HandlerFunc(h.gofoodImage)},
	}
}

// origin is appOrigin(request): the configured app URL, else the request
// origin (as forwarded by the Next proxy), without trailing slashes.
func (h *Handler) origin(r *http.Request) string {
	origin := h.appURL
	if origin == "" {
		scheme := "http"
		if r.TLS != nil || strings.EqualFold(strings.TrimSpace(strings.Split(r.Header.Get("x-forwarded-proto"), ",")[0]), "https") {
			scheme = "https"
		}
		host := r.Header.Get("x-forwarded-host")
		if host == "" {
			host = r.Host
		}
		origin = scheme + "://" + host
	}
	return strings.TrimRight(origin, "/")
}

/* ── GET/PUT /api/settings/gobiz ──────────────────────────────────────── */

type effectiveURLs struct {
	APIBase  string `json:"apiBase"`
	OAuthURL string `json:"oauthUrl"`
}

type lastSync struct {
	CreatedAt httpx.JSTime `json:"created_at"`
	Status    string       `json:"status"`
	ItemCount int          `json:"item_count"`
	Error     *string      `json:"error"`
}

type settingsView struct {
	Enabled            bool          `json:"enabled"`
	Environment        string        `json:"environment"`
	ClientID           string        `json:"client_id"`
	ClientSecretMasked *string       `json:"client_secret_masked"`
	HasClientSecret    bool          `json:"has_client_secret"`
	OutletID           string        `json:"outlet_id"`
	PartnerID          string        `json:"partner_id"`
	RelaySecretMasked  *string       `json:"relay_secret_masked"`
	HasRelaySecret     bool          `json:"has_relay_secret"`
	EnforceSignature   bool          `json:"enforce_signature"`
	AutoAccept         bool          `json:"auto_accept"`
	OAuthURL           string        `json:"oauth_url"`
	APIBaseURL         string        `json:"api_base_url"`
	EffectiveURLs      effectiveURLs `json:"effective_urls"`
	WebhookURL         string        `json:"webhook_url"`
	Configured         bool          `json:"configured"`
	LastCatalogSync    *lastSync     `json:"last_catalog_sync"`
}

// settingsResponse is gobizSettingsResponse: `{data}` without `success`.
// Secrets are masked; the webhook token is created on first read.
func (h *Handler) settingsResponse(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	values, err := h.svc.settings(ctx)
	if err != nil {
		return err
	}
	cfg := gobizapi.ConfigFromSettings(values)
	token, err := h.svc.webhookToken(ctx, cfg)
	if err != nil {
		return err
	}
	return httpx.JSON(w, http.StatusOK, struct {
		Data settingsView `json:"data"`
	}{settingsView{
		Enabled:            cfg.Enabled,
		Environment:        cfg.Environment,
		ClientID:           cfg.ClientID,
		ClientSecretMasked: appsettings.Mask(appsettings.Ptr(cfg.ClientSecret)),
		HasClientSecret:    cfg.ClientSecret != "",
		OutletID:           cfg.OutletID,
		PartnerID:          cfg.PartnerID,
		RelaySecretMasked:  appsettings.Mask(appsettings.Ptr(cfg.RelaySecret)),
		HasRelaySecret:     cfg.RelaySecret != "",
		EnforceSignature:   cfg.EnforceSignature,
		AutoAccept:         cfg.AutoAccept,
		OAuthURL:           values.Str(gobizapi.KeyOAuthURL),
		APIBaseURL:         values.Str(gobizapi.KeyAPIBaseURL),
		EffectiveURLs:      effectiveURLs{cfg.APIBase, cfg.OAuthURL},
		WebhookURL:         domain.WebhookURL(h.origin(r), token),
		Configured:         cfg.IsConfigured(),
		LastCatalogSync:    h.svc.lastCatalogSync(ctx),
	}})
}

func (h *Handler) getSettings(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.guard.RequireMenuPrefix(r, iam.SettingsIntegrations...); err != nil {
		return err
	}
	return h.settingsResponse(w, r)
}

// putSettings is PUT: an omitted field is unchanged, a blank string clears
// the setting.
func (h *Handler) putSettings(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.guard.RequireMenuPrefix(r, iam.SettingsIntegrations...); err != nil {
		return err
	}
	f := validate.New(validate.ReadBody(r))
	opt := validate.Rule{Optional: true}
	str := func(key string, max int) *string { return f.Str(key, opt, validate.StrOpts{Max: max}) }
	enabled := f.Bool("enabled", opt)
	environment := f.Enum("environment", opt, []string{gobizapi.Sandbox, gobizapi.Production})
	clientID, clientSecret := str("client_id", 200), str("client_secret", 500)
	outletID, partnerID := str("outlet_id", 200), str("partner_id", 200)
	relaySecret := str("relay_secret", 500)
	enforce, autoAccept := f.Bool("enforce_signature", opt), f.Bool("auto_accept", opt)
	oauthURL, apiBaseURL := str("oauth_url", 500), str("api_base_url", 500)
	if !f.Valid() {
		return httpx.BadRequest("Data tidak valid")
	}

	type write struct {
		key   string
		value *string
	}
	var writes []write
	flag := func(key string, b *bool) {
		if b != nil {
			v := "false"
			if *b {
				v = "true"
			}
			writes = append(writes, write{key, &v})
		}
	}
	text := func(key string, s *string) {
		if s != nil {
			writes = append(writes, write{key, appsettings.Ptr(domain.JSTrim(*s))})
		}
	}
	flag(gobizapi.KeyEnabled, enabled)
	if environment != nil {
		writes = append(writes, write{gobizapi.KeyEnvironment, environment})
	}
	text(gobizapi.KeyClientID, clientID)
	text(gobizapi.KeyClientSecret, clientSecret)
	text(gobizapi.KeyOutletID, outletID)
	text(gobizapi.KeyPartnerID, partnerID)
	text(gobizapi.KeyRelaySecret, relaySecret)
	flag(gobizapi.KeySignatureEnforce, enforce)
	flag(gobizapi.KeyAutoAccept, autoAccept)
	for _, u := range []struct {
		key, msg string
		value    *string
	}{{gobizapi.KeyOAuthURL, "OAuth URL harus https", oauthURL}, {gobizapi.KeyAPIBaseURL, "API base URL harus https", apiBaseURL}} {
		if u.value == nil {
			continue
		}
		if t := domain.JSTrim(*u.value); t != "" && !strings.HasPrefix(t, "https://") {
			return httpx.BadRequest(u.msg)
		}
		text(u.key, u.value)
	}

	ctx := r.Context()
	for _, wr := range writes {
		if err := appsettings.Set(ctx, h.svc.db, wr.key, wr.value); err != nil {
			return err
		}
	}
	if _, err := h.svc.ensureWebhookToken(ctx); err != nil {
		return err
	}
	return h.settingsResponse(w, r)
}

/* ── POST /api/settings/gobiz/actions ─────────────────────────────────── */

var actions = []string{"test", "register_webhooks", "sync_catalog", "regenerate_token"}

func (h *Handler) action(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.guard.RequireMenuPrefix(r, iam.SettingsIntegrations...); err != nil {
		return err
	}
	f := validate.New(validate.ReadBody(r))
	action := f.Enum("action", validate.Rule{}, actions)
	if !f.Valid() {
		return httpx.BadRequest("Aksi tidak valid")
	}

	ctx, origin := r.Context(), h.origin(r)
	var data any
	var err error
	switch *action {
	case "test":
		data, err = h.svc.TestConnection(ctx)
	case "register_webhooks":
		data, err = h.svc.RegisterWebhooks(ctx, origin)
	case "sync_catalog":
		data, err = h.svc.SyncCatalog(ctx, origin)
	case "regenerate_token":
		data, err = h.svc.RegenerateToken(ctx, origin)
	}
	var apiErr *gobizapi.APIError
	switch {
	case errors.Is(err, ErrNotConfigured):
		return httpx.BadRequest(err.Error())
	case errors.As(err, &apiErr):
		// GoBiz's status and body go to the UI for diagnosis.
		return httpx.JSON(w, http.StatusBadGateway, struct {
			Success bool            `json:"success"`
			Error   string          `json:"error"`
			Status  int             `json:"status"`
			Detail  json.RawMessage `json:"detail"`
		}{false, "GoBiz: " + apiErr.Message, apiErr.Status, apiErr.Body})
	case err != nil:
		return err
	}
	return httpx.Data(w, http.StatusOK, data)
}

/* ── POST /api/integrations/gobiz/webhook/{token} ─────────────────────── */

type webhookAnswer struct {
	Success   bool   `json:"success"`
	Data      any    `json:"data"`
	Ignored   bool   `json:"ignored,omitempty"`
	Reason    string `json:"reason,omitempty"`
	Processed *bool  `json:"processed,omitempty"`
}

var emptyData = struct{}{}

// header is Headers.get: nil when absent, repeated values joined.
func header(r *http.Request, name string) *string {
	values := r.Header.Values(name)
	if len(values) == 0 {
		return nil
	}
	v := strings.Join(values, ", ")
	return &v
}

// webhook receives GoBiz events. The random path token authenticates the
// caller; once a relay secret is set, X-Go-Signature (HMAC-SHA256 hex of the
// raw body) must be valid too. Events are stored by event_id for
// idempotency, and the answer is always 200 for an authenticated call so
// GoBiz does not retry events this side ignores or failed on.
func (h *Handler) webhook(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	cfg, err := h.svc.Config(ctx)
	if err != nil {
		return err
	}
	if !domain.SafeEqual(cfg.WebhookToken, r.PathValue("token")) {
		return httpx.Unauthorized("Unauthorized")
	}

	// Body.text(): UTF-8 decoded without a BOM; read once for the HMAC and
	// the parse.
	data, _ := io.ReadAll(io.LimitReader(r.Body, 10<<20))
	raw := strings.ToValidUTF8(strings.TrimPrefix(string(data), "\uFEFF"), "\uFFFD")
	sig := domain.VerifySignature(raw, deref(header(r, "x-go-signature")), cfg.RelaySecret)
	if sig != domain.SignatureValid && sig != domain.SignatureUnconfigured {
		h.svc.log.Warn("[gobiz webhook] X-Go-Signature " + sig + ", event ditolak")
		return httpx.Unauthorized("Invalid signature")
	}

	event := domain.ParseWebhook(raw)
	if event == nil {
		h.svc.log.Warn("[gobiz webhook] payload tidak dikenali", "body", truncate(raw, 500))
		return httpx.JSON(w, http.StatusOK, webhookAnswer{Success: true, Data: emptyData, Ignored: true, Reason: "unrecognized_payload"})
	}

	rowID, err := h.svc.RecordEvent(ctx, event, header(r, "x-go-idempotency-key"))
	if err == nil && rowID == "" {
		return httpx.JSON(w, http.StatusOK, webhookAnswer{Success: true, Data: emptyData, Ignored: true, Reason: "duplicate_event"})
	}
	var result string
	if err == nil {
		result, err = h.svc.ProcessEvent(ctx, cfg, event, rowID)
	}
	if err != nil {
		// The event row keeps result=error, so it can be reprocessed.
		h.svc.log.Error("[gobiz webhook] gagal", "event", event.Header.EventName, "event_id", event.Header.EventID, "error", err)
		processed := false
		return httpx.JSON(w, http.StatusOK, webhookAnswer{Success: true, Data: emptyData, Processed: &processed})
	}
	return httpx.JSON(w, http.StatusOK, webhookAnswer{Success: true, Data: struct {
		Result string `json:"result"`
	}{result}})
}

func deref(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

func truncate(s string, n int) string {
	if len(s) > n {
		return s[:n]
	}
	return s
}
