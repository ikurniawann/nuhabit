package gymscheduling

import (
	"context"
	"time"

	"nuhabit/backend/internal/modules/gymscheduling/domain"
)

// Repository is the persistence the use cases need. Postgres implements it;
// every method takes the Querier to run on (pool or transaction).
type Repository interface {
	ScheduleRepository

	ListClassTypes(ctx context.Context, q Q) ([]*Row, error)
	// InsertClassType returns "" when the name is taken (ON CONFLICT DO NOTHING).
	InsertClassType(ctx context.Context, q Q, in ClassTypeInput) (string, error)
	// UpdateClassType returns "" when the class type does not exist.
	UpdateClassType(ctx context.Context, q Q, id string, in ClassTypePatch) (string, error)
	ArchiveClassType(ctx context.Context, q Q, id string) (bool, error)
	ClassTypeDefaults(ctx context.Context, q Q, id string) (*ClassTypeDefaults, error)
	ActiveClassTypes(ctx context.Context, q Q) ([]*Row, error)

	ListCoaches(ctx context.Context, q Q) ([]*Row, error)
	InsertCoach(ctx context.Context, q Q, in CoachInput) (string, error)
	UpdateCoach(ctx context.Context, q Q, id string, in CoachPatch) (string, error)
	MemberCoaches(ctx context.Context, q Q) ([]*Row, error)
	ActiveCoach(ctx context.Context, q Q, id string) (*Row, error)
	ClassDetails(ctx context.Context, q Q, classTypeID string, coachID *string) (*Row, error)
	Catalog(ctx context.Context, q Q) (branches, classTypes, coaches []*Row, err error)

	ListSessions(ctx context.Context, q Q, f SessionFilter) ([]*Row, error)
	// LockSession returns nil when the session does not exist.
	LockSession(ctx context.Context, q Q, id string) (*SessionRow, error)
	InsertSession(ctx context.Context, q Q, n NewSession) (string, error)
	UpdateSession(ctx context.Context, q Q, id string, u SessionUpdate) error
	SetSessionStatus(ctx context.Context, q Q, id string, status domain.SessionStatus) error
	SessionHasBookings(ctx context.Context, q Q, id string) (bool, error)
	DeleteSession(ctx context.Context, q Q, id string) error
	SessionsInWeek(ctx context.Context, q Q, weekStart time.Time) ([]WeekSession, error)
	// InsertSessionIfFree returns "" when the class type already has a
	// session at that start in that branch.
	InsertSessionIfFree(ctx context.Context, q Q, n NewSession, endsAt time.Time) (string, error)
	// PublicBranch finds an active branch by its public slug (or code while
	// no slug is set); nil when none.
	PublicBranch(ctx context.Context, q Q, slug string) (*PublicBranch, error)
	// PublicWeekSessions lists the branch's open sessions in [from, to).
	PublicWeekSessions(ctx context.Context, q Q, branchID string, from, to time.Time) ([]PublicSession, error)

	SeatsHeld(ctx context.Context, q Q, sessionID string) (int, error)
	// OffersHeld counts waitlist offers still open at now: each holds a seat.
	OffersHeld(ctx context.Context, q Q, sessionID string, now time.Time) (int, error)
	// BookingStats counts open offers (at now) apart from confirmed seats.
	BookingStats(ctx context.Context, q Q, sessionID, customerID string, now time.Time) (BookingStats, error)
	// MemberCommitments lists the member's bookings outside sessionID that
	// limit a new one: confirmed for a class starting after now, or held
	// (confirmed, checked in, completed) for a class starting in [dayStart, dayEnd).
	MemberCommitments(ctx context.Context, q Q, customerID, sessionID string, dayStart, dayEnd, now time.Time) ([]Commitment, error)
	// PassStrikeTimes lists when each of the member's pass strikes was recorded.
	PassStrikeTimes(ctx context.Context, q Q, customerID string) ([]time.Time, error)
	// SessionsWithLapsedOffers lists sessions holding an offer that lapsed by now.
	SessionsWithLapsedOffers(ctx context.Context, q Q, now time.Time) ([]string, error)
	// CancelLapsedOffers cancels the session's offers that lapsed by now and
	// returns the members they were made to.
	CancelLapsedOffers(ctx context.Context, q Q, sessionID string, now time.Time) ([]string, error)
	InsertBooking(ctx context.Context, q Q, sessionID, customerID string, status domain.BookingStatus, position *int, source string) (string, error)
	// BookingRef returns empty ids when the booking does not exist.
	BookingRef(ctx context.Context, q Q, id string) (sessionID, customerID string, err error)
	LockBooking(ctx context.Context, q Q, id string) (*BookingRow, error)
	LockWaitlist(ctx context.Context, q Q, sessionID string) ([]BookingRow, error)
	LockOpenBookings(ctx context.Context, q Q, sessionID string) ([]BookingRow, error)
	CancelBooking(ctx context.Context, q Q, id string, late bool, at time.Time) error
	ConfirmFromWaitlist(ctx context.Context, q Q, id string) error
	AutoPromote(ctx context.Context, q Q, id string) error
	OfferPromotion(ctx context.Context, q Q, id string, at, expiresAt time.Time) error
	MarkNoShow(ctx context.Context, q Q, id string) error
	// MarkPassStrike flags a late cancel or no-show by a pass holder.
	MarkPassStrike(ctx context.Context, q Q, id string, at time.Time) error
	MarkCheckedIn(ctx context.Context, q Q, id string, at time.Time) error
	CloseBooking(ctx context.Context, q Q, id string, status domain.BookingStatus) error
	ActiveBookingCustomers(ctx context.Context, q Q, sessionID string) ([]string, error)
	// CancelSessionBookings cancels confirmed, waitlisted and checked-in
	// bookings and returns their members.
	CancelSessionBookings(ctx context.Context, q Q, sessionID string) ([]string, error)
	Roster(ctx context.Context, q Q, sessionID string) ([]*Row, error)
	ListBookings(ctx context.Context, q Q, f BookingListFilter) ([]*Row, error)
	MemberBookings(ctx context.Context, q Q, customerID string, past bool) ([]*Row, error)

	LastAllowedEntry(ctx context.Context, q Q, customerID string) (*time.Time, error)
	LockCheckInCandidate(ctx context.Context, q Q, customerID string, branchID *string, now time.Time) (*Candidate, error)
	LogAccess(ctx context.Context, q Q, e AccessEntry) error
	AccessLog(ctx context.Context, q Q) (log []*Row, today *Row, err error)

	// ReminderSessions lists open sessions starting in (from, to] that have a confirmed booking.
	ReminderSessions(ctx context.Context, q Q, from, to time.Time) ([]ReminderSession, error)
	// ReminderBookings lists a session's confirmed bookings still owed the reminder for period.
	ReminderBookings(ctx context.Context, q Q, sessionID, period string) ([]ReminderBooking, error)
}

// ClassTypeInput is classTypeSchema after defaults.
type ClassTypeInput struct {
	Name, Description                                      string
	DefaultDurationMin, DefaultCreditCost, DefaultCapacity int
	Color, Status                                          string
}

// ClassTypePatch is classTypeSchema.partial(); nil keeps the stored value.
type ClassTypePatch struct {
	Name, Description                                      *string
	DefaultDurationMin, DefaultCreditCost, DefaultCapacity *int
	Color, Status                                          *string
}

type ClassTypeDefaults struct {
	DurationMin, Capacity, CreditCost int
	Status                            string
}

// CoachInput is coachSchema after defaults.
type CoachInput struct {
	Name, Bio, Specialization  string
	PhotoURL, UserID, BranchID *string
	Status                     string
}

// CoachPatch is coachSchema.partial(). PhotoURL, BranchID and UserID may be
// cleared, so the *Sent flags say whether the key was in the body.
type CoachPatch struct {
	Name, Bio, Specialization, Status      *string
	PhotoURL, BranchID, UserID             *string
	PhotoURLSent, BranchIDSent, UserIDSent bool
}

// SessionFilter narrows ListSessions; nil fields do not filter.
type SessionFilter struct {
	ID          *string
	From, To    *time.Time
	ClassTypeID *string
	CoachID     *string
	BranchID    *string
	Statuses    []domain.SessionStatus
	// CustomerID adds that member's active booking as my_booking.
	CustomerID *string
}

// SessionRow is a session locked for update, with its class type and coach names.
type SessionRow struct {
	ID, ClassTypeID, ClassTypeName, Color string
	CoachID, CoachName, BranchID, Area    *string
	StartsAt, EndsAt                      time.Time
	Capacity, CreditCost                  int
	BookingOpensAt, BookingClosesAt       time.Time
	Status                                domain.SessionStatus
	Notes                                 *string
	MovedAt, OriginalStartsAt             *time.Time
}

// Move is the studio's last move of the session, for the late-cancel waiver.
func (s *SessionRow) Move() domain.SessionMove {
	return domain.SessionMove{MovedAt: s.MovedAt, OriginalStartsAt: s.OriginalStartsAt}
}

// slot is the session's place in the timetable for overlap checks.
func (s *SessionRow) slot() domain.Slot {
	return domain.Slot{ID: s.ID, ClassName: s.ClassTypeName, CoachID: s.CoachID, CoachName: s.CoachName,
		BranchID: s.BranchID, Area: s.Area, StartsAt: s.StartsAt, EndsAt: s.EndsAt}
}

// label is "<class>, <start in WIB>" for ledger notes.
func (s *SessionRow) label() string { return s.ClassTypeName + ", " + domain.FormatWib(s.StartsAt) }

type NewSession struct {
	ClassTypeID                     string
	CoachID, BranchID, Area         *string
	StartsAt                        time.Time
	DurationMin                     int
	Capacity, CreditCost            int
	BookingOpensAt, BookingClosesAt time.Time
	Status                          domain.SessionStatus
	Notes                           *string
	CreatedBy                       *string
	// TemplateID and OccurrenceDate are set on sessions generated from a template.
	TemplateID, OccurrenceDate *string
}

type SessionUpdate struct {
	ClassTypeID                     string
	CoachID, BranchID, Area, Notes  *string
	StartsAt                        time.Time
	DurationMin, Capacity           int
	CreditCost                      int
	BookingOpensAt, BookingClosesAt time.Time
	// MovedAt and OriginalStartsAt are set when the start changes.
	MovedAt, OriginalStartsAt *time.Time
}

// WeekSession is a session copied by DuplicateWeek.
type WeekSession struct {
	ClassTypeID             string
	CoachID, BranchID, Area *string
	StartsAt, EndsAt        time.Time
	Capacity, CreditCost    int
	Notes                   *string
}

type BookingStats struct {
	Confirmed, Offered, LastWaitlist int
	Mine                             bool
}

// Commitment is one of the member's other bookings, as reservation and
// booking caps see it.
type Commitment struct {
	Status     domain.BookingStatus
	StartsAt   time.Time
	CreditCost int
}

type BookingRow struct {
	ID, SessionID, CustomerID string
	Status                    domain.BookingStatus
	WaitlistPosition          *int
	PromotionOfferedAt        *time.Time
	PromotionExpiresAt        *time.Time
	CreatedAt                 time.Time
}

func (b BookingRow) waitlistEntry() domain.WaitlistEntry {
	return domain.WaitlistEntry{
		ID: b.ID, CustomerID: b.CustomerID, Status: b.Status, WaitlistPosition: b.WaitlistPosition,
		CreatedAt: b.CreatedAt, PromotionOfferedAt: b.PromotionOfferedAt,
	}
}

type BookingListFilter struct {
	From, To  time.Time
	Status    *string
	Q         *string
	SessionID *string
}

// Candidate is the confirmed booking the gate may check in now.
type Candidate struct {
	ID, SessionID, ClassTypeID string
	CreditCost                 int
	StartsAt                   time.Time
	ClassName                  string
}

// AccessEntry is one gym.access_logs row.
type AccessEntry struct {
	CustomerID, BookingID, BranchID *string
	Decision                        domain.Decision
	Reason                          *string
	EntryKind                       *string
	CreditsDeducted                 int
	Source                          string
	ScannedBy                       *string
}
