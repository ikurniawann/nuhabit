package gymcoachleave

import (
	"context"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
)

// DB is a pool or a transaction: Begin on a transaction opens a savepoint.
type DB interface {
	database.Querier
	Begin(ctx context.Context) (pgx.Tx, error)
}

// Schedule changes the sessions of a leave through gym-scheduling and
// gym-coaching, on the caller's transaction, so the overlap checks, the
// refunds and the member notices are theirs.
type Schedule interface {
	// SetSessionCoach hands a class session to coachID.
	SetSessionCoach(ctx context.Context, db DB, sessionID, coachID string) error
	// CancelSession cancels a class session, refunding and telling members.
	CancelSession(ctx context.Context, db DB, sessionID string) error
	// SetPTCoach hands a PT session to coachID at the same time.
	SetPTCoach(ctx context.Context, db DB, appointmentID, coachID string, startsAt time.Time) error
	// CancelPT cancels a PT session, releasing and telling its members.
	CancelPT(ctx context.Context, db DB, appointmentID, reason string) error
}

// Ports are what this module needs from other contexts.
type Ports struct {
	Schedule Schedule
}

// Service holds the coach leave use cases.
type Service struct {
	db    DB
	ports Ports
	now   func() time.Time
	log   *slog.Logger
}

// NewService wires the use cases; now and log may be nil.
func NewService(db DB, ports Ports, now func() time.Time, log *slog.Logger) *Service {
	if now == nil {
		now = time.Now
	}
	if log == nil {
		log = slog.Default()
	}
	return &Service{db: db, ports: ports, now: now, log: log}
}

func (s *Service) inTx(ctx context.Context, fn func(tx pgx.Tx) error) error {
	return database.WithTx(ctx, s.db, fn)
}

// asDB is q as a DB; the HRIS hooks hand over their transaction.
func asDB(q database.Querier) (DB, error) {
	db, ok := q.(DB)
	if !ok {
		return nil, httpx.Status(500, "coach leave: querier cannot open a savepoint")
	}
	return db, nil
}

func conflict(msg string) error { return httpx.Conflict(msg) }
