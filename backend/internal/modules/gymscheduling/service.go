// Package gymscheduling owns the gym class schedule: class types, coaches,
// sessions, bookings with their waitlist, and the gate check-in that charges
// credits. Port of frontend/src/lib/gym/{booking*,session-*,gym-checkin-server,
// catalog-server}.ts.
//
// Credits are checked at booking and charged at check-in, late cancel or
// no-show, always through the CreditLedger port. Business rules, members,
// QR tokens and member notifications belong to other contexts and are reached
// through ports wired in internal/app.
package gymscheduling

import (
	"context"
	"log/slog"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/gymscheduling/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
)

// ── Ports ───────────────────────────────────────────────────────────────────
// Every port method takes the Querier of the running transaction, so a credit
// deduction commits or rolls back together with the booking it pays for.

// CreditLedger is the gym credit wallet (owned by gym-credits).
type CreditLedger interface {
	// GetBalance is the spendable balance after lapsed lots are expired.
	GetBalance(ctx context.Context, q database.Querier, customerID string) (int, error)
	// Deduct charges credits idempotently; OK=false means the balance was short.
	Deduct(ctx context.Context, q database.Querier, in CreditMovement) (DeductResult, error)
	Refund(ctx context.Context, q database.Querier, in CreditMovement) error
	// CoveredClassTypeIDs lists the class types live credits may book; nil means all.
	CoveredClassTypeIDs(ctx context.Context, q database.Querier, customerID string) ([]string, error)
}

// UsableBalancer is an optional CreditLedger method: the balance that may
// pay for one class type, when credits are restricted by class type.
// Without it booking falls back to GetBalance.
type UsableBalancer interface {
	UsableBalance(ctx context.Context, q database.Querier, customerID, classTypeID string) (int, error)
}

// CreditMovement is one deduction or refund on the ledger.
type CreditMovement struct {
	CustomerID     string
	Amount         int
	SourceType     string
	SourceID       string
	IdempotencyKey string
	Note           string
}

type DeductResult struct {
	OK           bool
	BalanceAfter int
}

// PackageCoverage is one credit package and the class types it is valid for
// (nil = all). The member app catalog lists them.
type PackageCoverage struct {
	ID           string   `json:"id"`
	ClassTypeIDs []string `json:"class_type_ids"`
}

// CreditPackages lists package coverage (owned by gym-credits).
type CreditPackages interface {
	Coverage(ctx context.Context, q database.Querier) ([]PackageCoverage, error)
}

// RulesSource resolves gym.business_rules for a branch (nil = global).
type RulesSource interface {
	ForBranch(ctx context.Context, q database.Querier, branchID *string) (domain.Rules, error)
}

// ActivePass is a membership pass covering one instant (owned by gym-credits).
// CoversPersonal: the pass pays for PT sessions too, not only classes.
type ActivePass struct {
	ID             string
	EndsAt         time.Time
	CoversPersonal bool
}

// Passes reads member passes: a pass covering a session start replaces the
// credit requirement at booking and the deduction at check-in.
type Passes interface {
	// ActivePassAt is the pass covering at, nil when none.
	ActivePassAt(ctx context.Context, q database.Querier, customerID string, at time.Time) (*ActivePass, error)
}

// Member is what scheduling needs to know about a POS customer.
type Member struct {
	Name     *string
	IsActive *bool
	// WaiverVersion and WaiverAcceptedAt are the waiver the member accepted.
	WaiverVersion    *string
	WaiverAcceptedAt *time.Time
}

// Active treats a NULL is_active as active, like `is_active !== false`.
func (m *Member) Active() bool { return m != nil && (m.IsActive == nil || *m.IsActive) }

// MemberHit is a member search result for staff booking, with the pass
// strikes counting now and the end of a strike suspension, under the rules
// of RulesBranchID (nil: the global rules).
type MemberHit struct {
	ID              string  `json:"id"`
	Name            *string `json:"name"`
	Phone           *string `json:"phone"`
	IsActive        *bool   `json:"is_active"`
	Credits         int     `json:"credits"`
	PassStrikes     int     `json:"pass_strikes"`
	SuspendedUntil  *jsTime `json:"suspended_until"`
	RulesBranchID   *string `json:"rules_branch_id"`
	RulesBranchName *string `json:"rules_branch_name"`
}

// Members reads pos.pos_customers (owned by the POS/CRM context).
type Members interface {
	// Get returns nil when the customer does not exist.
	Get(ctx context.Context, q database.Querier, id string) (*Member, error)
	// Search matches name or phone, at most 10 hits, Credits left zero.
	Search(ctx context.Context, q database.Querier, term string) ([]MemberHit, error)
}

// QrTokens reads and consumes member QR credentials (owned by CRM).
type QrTokens interface {
	// Lock returns nil when the token is unknown.
	Lock(ctx context.Context, q database.Querier, token string) (*domain.QrToken, error)
	Consume(ctx context.Context, q database.Querier, token string, at time.Time) error
}

// Notification is an in-app message to a member. DeliverAfter holds the
// push and WhatsApp back (quiet hours); zero sends after commit.
type Notification struct {
	Type         string
	Title        string
	Body         string
	DeliverAfter time.Time
}

// PTCandidate is a confirmed personal training session the gate may check
// the member in to (owned by gym-coaching). BookingID is the participant row.
type PTCandidate struct {
	ParticipantID, AppointmentID, ClassTypeID, ClassName string
	CreditCost                                           int
	StartsAt, EndsAt                                     time.Time
	// Covered: a pass pays for the session, so check-in costs no credits.
	Covered bool
}

// PersonalTraining lets the gate admit a member for a PT session when no
// class booking starts sooner. nil means PT sessions are not checked in.
type PersonalTraining interface {
	// LockGateCandidate is the member's first confirmed PT session at the
	// branch starting by now+early and ending at or after now-late that the
	// member has not checked in to; nil when none.
	LockGateCandidate(ctx context.Context, q database.Querier, customerID string, branchID *string, now time.Time, early, late time.Duration) (*PTCandidate, error)
	// GateCheckIn marks the participant checked in and charges the session
	// the way its completion does. ok=false means the PT credits were short.
	GateCheckIn(ctx context.Context, q database.Querier, participantID string, now time.Time) (charged int, ok bool, err error)
}

// TierPerks reads what a member's membership tier and status change in
// booking: earlier booking, their own late-cancel window, waitlist priority,
// and a ban (owned by gym-loyalty). nil means no tier changes anything.
type TierPerks interface {
	TierPerks(ctx context.Context, q database.Querier, customerID string) (domain.MemberPerks, error)
}

// Notifier delivers member notifications (owned by CRM).
type Notifier interface {
	NotifyMember(ctx context.Context, q database.Querier, customerID string, n Notification) error
}

// DB is a pool or a transaction: Begin on a transaction opens a savepoint,
// which lets integration tests run a whole use case inside a rolled-back tx.
type DB interface {
	database.Querier
	Begin(ctx context.Context) (pgx.Tx, error)
}

// Ports bundles the adapters internal/app wires in.
type Ports struct {
	Credits  CreditLedger
	Packages CreditPackages
	Passes   Passes
	Rules    RulesSource
	Members  Members
	Qr       QrTokens
	Notifier Notifier
	PT       PersonalTraining
	Perks    TierPerks
	// WaiverVersion is the waiver text members accept today; "" accepts
	// any version on record.
	WaiverVersion string
}

// waiverMissing: the branch rules need a waiver this member has not
// accepted in its current version.
func (s *Service) waiverMissing(rules domain.Rules, m *Member) bool {
	if m == nil {
		return false
	}
	return domain.WaiverMissing(rules, m.WaiverVersion, m.WaiverAcceptedAt, s.WaiverVersion)
}

// memberPerks are the member's tier perks; none without the port.
func (s *Service) memberPerks(ctx context.Context, q database.Querier, customerID string) (domain.MemberPerks, error) {
	if s.Perks == nil {
		return domain.MemberPerks{}, nil
	}
	return s.Perks.TierPerks(ctx, q, customerID)
}

// Service implements the scheduling use cases.
type Service struct {
	db   DB
	repo Repository
	Ports
	now func() time.Time
	// log records failures that must not undo the write around them
	// (member notifications). nil means slog.Default().
	log *slog.Logger
}

func (s *Service) logger() *slog.Logger {
	if s.log == nil {
		return slog.Default()
	}
	return s.log
}

func NewService(db DB, repo Repository, ports Ports, now func() time.Time) *Service {
	if now == nil {
		now = time.Now
	}
	return &Service{db: db, repo: repo, Ports: ports, now: now}
}

func (s *Service) inTx(ctx context.Context, fn func(q database.Querier) error) (err error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() {
		if p := recover(); p != nil {
			_ = tx.Rollback(context.WithoutCancel(ctx))
			panic(p)
		}
		if err != nil {
			_ = tx.Rollback(context.WithoutCancel(ctx))
		}
	}()
	if err = fn(tx); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// schedulingError is SchedulingError: a business failure safe to show (default 409).
func schedulingError(msg string, status ...int) *httpx.Error {
	code := 409
	if len(status) > 0 {
		code = status[0]
	}
	return httpx.Status(code, msg)
}

// codedError is a schedulingError with the stable code the member app
// translates; params are the numbers its copy interpolates.
func codedError(code, msg string, params map[string]any, status ...int) *httpx.Error {
	e := schedulingError(msg, status...)
	e.Code, e.Params = code, params
	return e
}

// denialCode is the stable code of a booking denial, e.g. BOOKING_DAILY_LIMIT.
func denialCode(r domain.BookingDenialReason) string {
	return "BOOKING_" + strings.ToUpper(string(r))
}

// denialError is a booking denial with its code and the numbers behind it.
func denialError(in domain.EligibilityInput, r domain.BookingDenialReason) *httpx.Error {
	var params map[string]any
	switch r {
	case domain.DenyInsufficientCredits:
		params = map[string]any{"available": max(in.Available(), 0), "needed": in.Session.CreditCost, "reserved": in.Reserved}
	case domain.DenyConcurrentLimit:
		params = map[string]any{"max": in.MaxConcurrent}
	case domain.DenyDailyLimit:
		params = map[string]any{"max": in.MaxPerDay}
	case domain.DenyPassSuspended:
		params = map[string]any{"until": in.SuspendedUntil.UTC().Format(time.RFC3339)}
	}
	return codedError(denialCode(r), in.DenialMessage(r), params)
}
