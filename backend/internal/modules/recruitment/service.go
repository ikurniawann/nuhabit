// Package recruitment is the recruitment pipeline API: candidates and their
// screening, psikotes, interview AI and offer panels; the psikotes bank;
// the anonymous candidate portals (psikotes, interview, offer) keyed by link
// token; live monitoring; job openings, positions and the promotion of a
// candidate to employee.
package recruitment

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/recruitment/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/ratelimit"
)

// Service holds the recruitment use cases.
type Service struct {
	db      database.DB
	repo    Postgres
	ports   Ports
	now     func() time.Time
	log     *slog.Logger
	limiter *ratelimit.Limiter
}

// NewService builds the service on a pool (or a test transaction).
func NewService(db database.DB, ports Ports, now func() time.Time, log *slog.Logger) *Service {
	if now == nil {
		now = time.Now
	}
	if log == nil {
		log = slog.Default()
	}
	return &Service{db: db, ports: ports, now: now, log: log, limiter: ratelimit.New(db)}
}

// Actor is the staff member a change is attributed to.
type Actor struct {
	ID       string
	FullName string
	Role     string
}

func (s *Service) inTx(ctx context.Context, fn func(tx pgx.Tx) error) error {
	return database.WithTx(ctx, s.db, fn)
}

// allow is checkRateLimit(key, limit).allowed, counted across replicas.
func (s *Service) allow(ctx context.Context, key string, limit int) (bool, error) {
	w, err := s.limiter.Fixed(ctx, key, limit, domain.RateWindow, s.now())
	return w.Allowed, err
}

// enforce is enforceRateLimit: 429 with the given message.
func (s *Service) enforce(ctx context.Context, key string, limit int, message string) error {
	allowed, err := s.allow(ctx, key, limit)
	if err == nil && !allowed {
		return httpx.TooManyRequests(message)
	}
	return err
}

// newPortalToken is crypto.randomBytes(32).toString("hex").
func newPortalToken() string {
	b := make([]byte, 32)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

const (
	msgCandidateNotFound = "Kandidat tidak ditemukan"
	msgBadCandidateID    = "ID kandidat tidak valid"
)

// requireCandidate is requireCandidate: 400 for a non-uuid id, 404 when the
// candidate is missing. It returns the current status.
func (s *Service) requireCandidate(ctx context.Context, id string) (string, error) {
	if !domain.IsUUID(id) {
		return "", httpx.BadRequest(msgBadCandidateID)
	}
	status, ok, err := s.repo.CandidateStatus(ctx, s.db, id)
	if err != nil {
		return "", err
	}
	if !ok {
		return "", httpx.NotFound(msgCandidateNotFound)
	}
	return status, nil
}
