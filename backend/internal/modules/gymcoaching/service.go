// Package gymcoaching owns personal training (PT) and fitness assessments:
// coach weekly availability and exceptions, PT appointments with their
// participants, and the body metrics and HYROX benchmarks staff record for
// a member.
//
// PT uses the gym credit wallet like classes do: credits of personal class
// types (gym.class_types.is_personal) are checked when a session is booked
// and charged when it completes, on a late cancel or on a no-show. Credits,
// business rules, the group class timetable and member notifications belong
// to other contexts and are reached through Ports wired in internal/app.
// Coaches, class types and members are read from their tables directly.
package gymcoaching

import (
	"context"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/gymcoaching/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/localtime"
)

// Q runs queries inside the caller's transaction.
type Q = database.Querier

// CreditMove is one deduction for a PT session.
type CreditMove struct {
	CustomerID     string
	ClassTypeID    string
	Amount         int
	SourceType     string
	SourceID       string
	IdempotencyKey string
	Note           string
}

// Credits is the gym credit wallet (owned by gym-credits).
type Credits interface {
	// UsableBalance is the credits that may pay for classTypeID.
	UsableBalance(ctx context.Context, q Q, customerID, classTypeID string) (int, error)
	// Deduct charges idempotently; false means the usable credits were short.
	Deduct(ctx context.Context, q Q, m CreditMove) (bool, error)
}

// ActivePass is a membership pass covering one instant (owned by
// gym-credits). CoversPersonal: the pass pays for PT sessions too.
type ActivePass struct {
	ID             string
	CoversPersonal bool
}

// Passes reads member passes: one covering personal training replaces the
// PT credit at booking, check-in and completion, as a pass does for classes.
type Passes interface {
	// ActivePassAt is the pass covering at, nil when none.
	ActivePassAt(ctx context.Context, q Q, customerID string, at time.Time) (*ActivePass, error)
}

// RulesSource resolves the gym business rules of a branch (nil = global).
type RulesSource interface {
	ForBranch(ctx context.Context, q Q, branchID *string) (domain.Rules, error)
}

// Schedule is the coach timetable shared with group classes (owned by
// gym-scheduling).
type Schedule interface {
	// Lock serializes timetable writes for the rest of the transaction.
	Lock(ctx context.Context, q Q) error
	// CoachClash names the class or PT appointment that already holds the
	// coach in [start, end), "" when the coach is free. appointmentID is
	// skipped, so a moved appointment never clashes with itself.
	CoachClash(ctx context.Context, q Q, appointmentID, coachID string, start, end time.Time) (string, error)
}

// Notification is an inbox message to a member.
type Notification struct {
	Type, Title, Body string
}

// Notifier stores a member notification and hands it to web push,
// WhatsApp and email (gym.member.notified).
type Notifier interface {
	NotifyMember(ctx context.Context, q Q, customerID string, n Notification) error
}

// StaffNotifier tells the staff account linked to a coach about a PT
// request or move: the dashboard inbox, plus WhatsApp and email when the
// account has them. Nil means coaches are not told.
type StaffNotifier interface {
	NotifyCoach(ctx context.Context, q Q, coachID string, n Notification) error
}

// Ports are the adapters internal/app wires in.
type Ports struct {
	Credits  Credits
	Passes   Passes
	Rules    RulesSource
	Schedule Schedule
	Notifier Notifier
	Staff    StaffNotifier
}

// Service implements the PT and assessment use cases.
type Service struct {
	db    database.DB
	ports Ports
	now   func() time.Time
	log   *slog.Logger
}

// NewService builds the service; now and log may be nil.
func NewService(db database.DB, ports Ports, now func() time.Time, log *slog.Logger) *Service {
	if now == nil {
		now = time.Now
	}
	if log == nil {
		log = slog.Default()
	}
	return &Service{db: db, ports: ports, now: now, log: log}
}

func (s *Service) inTx(ctx context.Context, fn func(q Q) error) error {
	return database.WithTx(ctx, s.db, func(tx pgx.Tx) error { return fn(tx) })
}

// notify sends a member notification in a savepoint: a failure rolls back
// only the notification and is logged, never the write it reports on.
func (s *Service) notify(ctx context.Context, q Q, customerID string, n Notification) {
	err := func() error {
		tb, ok := q.(database.TxBeginner)
		if !ok {
			return s.ports.Notifier.NotifyMember(ctx, q, customerID, n)
		}
		return database.WithTx(ctx, tb, func(sp pgx.Tx) error { return s.ports.Notifier.NotifyMember(ctx, sp, customerID, n) })
	}()
	if err != nil {
		s.log.WarnContext(ctx, "gym notification not sent", "type", n.Type, "customer_id", customerID, "error", err.Error())
	}
}

// passCovers reports a pass of the member covering PT sessions at the
// instant at. Without a Passes port passes never cover PT.
func (s *Service) passCovers(ctx context.Context, q Q, customerID string, at time.Time) (bool, error) {
	if s.ports.Passes == nil {
		return false, nil
	}
	pass, err := s.ports.Passes.ActivePassAt(ctx, q, customerID, at)
	return pass != nil && pass.CoversPersonal, err
}

// notifyStaff is notify for the coach's staff account; without a Staff
// port nothing is sent.
func (s *Service) notifyStaff(ctx context.Context, q Q, coachID string, n Notification) {
	if s.ports.Staff == nil {
		return
	}
	err := func() error {
		tb, ok := q.(database.TxBeginner)
		if !ok {
			return s.ports.Staff.NotifyCoach(ctx, q, coachID, n)
		}
		return database.WithTx(ctx, tb, func(sp pgx.Tx) error { return s.ports.Staff.NotifyCoach(ctx, sp, coachID, n) })
	}()
	if err != nil {
		s.log.WarnContext(ctx, "gym staff notification not sent", "type", n.Type, "coach_id", coachID, "error", err.Error())
	}
}

// branchRules reads the rules once per branch for the length of one operation.
func (s *Service) branchRules(q Q) func(ctx context.Context, branchID *string) (domain.Rules, error) {
	cache := map[string]domain.Rules{}
	return func(ctx context.Context, branchID *string) (domain.Rules, error) {
		key := ""
		if branchID != nil {
			key = *branchID
		}
		if r, ok := cache[key]; ok {
			return r, nil
		}
		r, err := s.ports.Rules.ForBranch(ctx, q, branchID)
		if err == nil {
			cache[key] = r
		}
		return r, err
	}
}

// conflict is a business failure safe to show staff and members (409).
func conflict(msg string) error { return httpx.Conflict(msg) }

// today is the current date in zone.
func (s *Service) today(zone *time.Location) string { return localtime.DayKey(s.now(), zone) }

// coachZone is the zone of the coach's branch: weekly availability and
// exceptions read in it. Jakarta without a coach or a branch.
func coachZone(ctx context.Context, q Q, coachID *string) (*time.Location, error) {
	var branchID *string
	if coachID != nil {
		err := q.QueryRow(ctx, `SELECT branch_id::text FROM gym.coaches WHERE id = $1`, *coachID).Scan(&branchID)
		if err != nil && !isNoRows(err) {
			return nil, err
		}
	}
	return localtime.BranchZone(ctx, q, branchID)
}

// CoachForUser is the active coach linked to a staff account, "" when none.
func (s *Service) CoachForUser(ctx context.Context, userID string) (string, error) {
	var id string
	err := s.db.QueryRow(ctx,
		`SELECT id::text FROM gym.coaches WHERE user_id = $1 AND status = 'active' ORDER BY created_at LIMIT 1`, userID).Scan(&id)
	if isNoRows(err) {
		return "", nil
	}
	return id, err
}

var isNoRows = database.IsNoRows
