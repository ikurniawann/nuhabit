package gymscheduling

import (
	"context"
	"encoding/json"
	"time"

	"nuhabit/backend/internal/modules/gymscheduling/domain"
	"nuhabit/backend/internal/platform/validate"
)

// Read side: session lists, roster, cancel preview, bookings, gate log, and
// the member portal views. Port of session-queries.ts and the member-portal
// gym routes.

func (s *Service) ListSessions(ctx context.Context, f SessionFilter) ([]*Row, error) {
	return s.repo.ListSessions(ctx, s.db, f)
}

// GetSession returns nil when the session does not exist.
func (s *Service) GetSession(ctx context.Context, id string, customerID *string) (*Row, error) {
	rows, err := s.repo.ListSessions(ctx, s.db, SessionFilter{ID: &id, CustomerID: customerID})
	if err != nil || len(rows) == 0 {
		return nil, err
	}
	return rows[0], nil
}

func (s *Service) Roster(ctx context.Context, sessionID string) ([]*Row, error) {
	return s.repo.Roster(ctx, s.db, sessionID)
}

func (s *Service) ListBookings(ctx context.Context, f BookingListFilter) ([]*Row, error) {
	return s.repo.ListBookings(ctx, s.db, f)
}

// AccessLog is the last 100 gym scans plus today's totals, each scan's day
// read in the zone of the branch it happened at.
func (s *Service) AccessLog(ctx context.Context) (*Row, error) {
	log, today, err := s.repo.AccessLog(ctx, s.db)
	if err != nil {
		return nil, err
	}
	return object("log", log, "today", today), nil
}

// StrikeScope picks the branch whose rules count a member's pass strikes:
// the session's when the search books into one, else BranchID (the staff
// member's branch). Neither means the global rules.
type StrikeScope struct {
	SessionID, BranchID *string
}

// strikeBranch resolves the scope to a branch id (nil for the global rules)
// and its name.
func (s *Service) strikeBranch(ctx context.Context, scope StrikeScope) (id, name *string, err error) {
	id = scope.BranchID
	if scope.SessionID != nil {
		session, err := s.GetSession(ctx, *scope.SessionID, nil)
		if err != nil {
			return nil, nil, err
		}
		if session == nil {
			return nil, nil, schedulingError("Sesi tidak ditemukan", 404)
		}
		id = session.StrPtr("branch_id")
	}
	if id == nil {
		return nil, nil, nil
	}
	name, err = s.repo.BranchName(ctx, s.db, *id)
	return id, name, err
}

// SearchBookableMembers finds members by name or phone, with their balance
// and their pass strikes under the rules of the scope's branch, the same
// rules a booking into that branch applies.
func (s *Service) SearchBookableMembers(ctx context.Context, term string, scope StrikeScope) ([]MemberHit, error) {
	if validate.UTF16Len(term) < 2 {
		return []MemberHit{}, nil
	}
	hits, err := s.Members.Search(ctx, s.db, term)
	if err != nil {
		return nil, err
	}
	branchID, branchName, err := s.strikeBranch(ctx, scope)
	if err != nil {
		return nil, err
	}
	rules, err := s.Rules.ForBranch(ctx, s.db, branchID)
	if err != nil {
		return nil, err
	}
	now := s.now()
	for i := range hits {
		if hits[i].Credits, err = s.Credits.GetBalance(ctx, s.db, hits[i].ID); err != nil {
			return nil, err
		}
		strikes, err := s.repo.PassStrikeTimes(ctx, s.db, hits[i].ID)
		if err != nil {
			return nil, err
		}
		st := domain.EvaluatePassStrikes(strikes, rules, now)
		hits[i].PassStrikes = st.Strikes
		hits[i].RulesBranchID, hits[i].RulesBranchName = branchID, branchName
		if st.SuspendedUntil != nil {
			until := jsTime(*st.SuspendedUntil)
			hits[i].SuspendedUntil = &until
		}
	}
	return hits, nil
}

// cancelInfo is the member portal's cancel preview: the free deadline and
// what cancelling now would forfeit (credits, or a strike on a pass).
type cancelInfo struct {
	Deadline       jsTime              `json:"deadline"`
	Late           bool                `json:"late"`
	PenaltyCredits int                 `json:"penalty_credits"`
	PassStrike     bool                `json:"pass_strike"`
	Policy         domain.CreditPolicy `json:"policy"`
}

// myBookingStatus reads my_booking.status and created_at from a session row.
func myBookingStatus(r *Row) (domain.BookingStatus, time.Time) {
	raw, ok := r.Get("my_booking").(json.RawMessage)
	if !ok {
		return "", time.Time{}
	}
	var mine struct {
		Status    domain.BookingStatus `json:"status"`
		CreatedAt time.Time            `json:"created_at"`
	}
	_ = json.Unmarshal(raw, &mine)
	return mine.Status, mine.CreatedAt
}

func bookingStatusColumn(r *Row) (domain.BookingStatus, time.Time) {
	return domain.BookingStatus(r.Str("status")), r.Time("created_at")
}

// sessionMove reads moved_at and original_starts_at from a row.
func sessionMove(r *Row) domain.SessionMove {
	at := func(key string) *time.Time {
		if t, ok := r.Get(key).(jsTime); ok {
			v := time.Time(t)
			return &v
		}
		return nil
	}
	return domain.SessionMove{MovedAt: at("moved_at"), OriginalStartsAt: at("original_starts_at")}
}

// attachCancelInfo adds cancel_info to each row: null unless the member's
// booking is confirmed. Rules are read once per branch. A session the studio
// moved shows the waived deadline the cancel itself will apply.
func (s *Service) attachCancelInfo(ctx context.Context, customerID string, rows []*Row, booking func(*Row) (domain.BookingStatus, time.Time), now time.Time) error {
	rulesFor := s.branchRules(s.db)
	perks, err := s.memberPerks(ctx, s.db, customerID)
	if err != nil {
		return err
	}
	for _, r := range rows {
		st, bookedAt := booking(r)
		if st != domain.BookingConfirmed {
			r.Set("cancel_info", nil)
			continue
		}
		rules, err := rulesFor(ctx, r.StrPtr("branch_id"))
		if err != nil {
			return err
		}
		rules = perks.CancelRules(rules)
		pass, err := s.Passes.ActivePassAt(ctx, s.db, customerID, r.Time("starts_at"))
		if err != nil {
			return err
		}
		out := domain.EvaluateCancellation(st, r.Time("starts_at"), r.Int("credit_cost"), pass != nil, rules, now)
		out = domain.WaiveLateCancelForMove(out, sessionMove(r), bookedAt, rules, now)
		r.Set("cancel_info", cancelInfo{
			Deadline: jsTime(out.Deadline), Late: out.Late, PenaltyCredits: out.PenaltyCredits, PassStrike: out.PassStrike,
			Policy: rules.LateCancelPolicy,
		})
	}
	return nil
}

// shiftBookingOpens shows each session's booking opening for the member,
// earlier by their tier's early booking days.
func (s *Service) shiftBookingOpens(ctx context.Context, customerID string, rows []*Row) error {
	perks, err := s.memberPerks(ctx, s.db, customerID)
	if err != nil || perks.EarlyBookingDays == 0 {
		return err
	}
	for _, r := range rows {
		if opens := r.Time("booking_opens_at"); !opens.IsZero() {
			r.Set("booking_opens_at", jsTime(perks.BookingOpensAt(opens)))
		}
	}
	return nil
}

// activePass is the member's pass covering now, as the member views list
// it (null when none).
func (s *Service) activePass(ctx context.Context, customerID string, now time.Time) (any, error) {
	pass, err := s.Passes.ActivePassAt(ctx, s.db, customerID, now)
	if err != nil || pass == nil {
		return nil, err
	}
	return object("id", pass.ID, "ends_at", jsTime(pass.EndsAt)), nil
}

var bookableStatuses = []domain.SessionStatus{domain.SessionPublished, domain.SessionFull}

// MemberSessions lists published classes that have not started, with seats
// left, the member's booking and cancel preview, their balance, and the
// active class types for filters.
func (s *Service) MemberSessions(ctx context.Context, customerID string, from, to time.Time, classTypeID, coachID *string) (*Row, error) {
	now := s.now()
	if from.Before(now) {
		from = now
	}
	sessions, err := s.repo.ListSessions(ctx, s.db, SessionFilter{
		From: &from, To: &to, ClassTypeID: classTypeID, CoachID: coachID,
		Statuses: bookableStatuses, CustomerID: &customerID,
	})
	if err != nil {
		return nil, err
	}
	if err := s.attachCancelInfo(ctx, customerID, sessions, myBookingStatus, now); err != nil {
		return nil, err
	}
	if err := s.shiftBookingOpens(ctx, customerID, sessions); err != nil {
		return nil, err
	}
	credits, err := s.Credits.GetBalance(ctx, s.db, customerID)
	if err != nil {
		return nil, err
	}
	pass, err := s.activePass(ctx, customerID, now)
	if err != nil {
		return nil, err
	}
	classTypes, err := s.repo.ActiveClassTypes(ctx, s.db)
	if err != nil {
		return nil, err
	}
	return object("sessions", sessions, "credits", credits, "active_pass", pass, "class_types", classTypes), nil
}

// MemberSession is one class with description, coach profile and cancel
// preview; nil for a missing or draft session.
func (s *Service) MemberSession(ctx context.Context, customerID, id string) (*Row, error) {
	session, err := s.GetSession(ctx, id, &customerID)
	if err != nil || session == nil || session.Str("status") == string(domain.SessionDraft) {
		return nil, err
	}
	if err := s.attachCancelInfo(ctx, customerID, []*Row{session}, myBookingStatus, s.now()); err != nil {
		return nil, err
	}
	if err := s.shiftBookingOpens(ctx, customerID, []*Row{session}); err != nil {
		return nil, err
	}
	details, err := s.repo.ClassDetails(ctx, s.db, session.Str("class_type_id"), session.StrPtr("coach_id"))
	if err != nil {
		return nil, err
	}
	if details != nil {
		for _, k := range details.keys {
			session.Set(k, details.Get(k))
		}
	}
	return session, nil
}

// MemberBookings: upcoming active bookings (with cancel preview) or the last
// 50 past ones in any status.
func (s *Service) MemberBookings(ctx context.Context, customerID string, past bool) ([]*Row, error) {
	rows, err := s.repo.MemberBookings(ctx, s.db, customerID, past)
	if err != nil {
		return nil, err
	}
	return rows, s.attachCancelInfo(ctx, customerID, rows, bookingStatusColumn, s.now())
}

func (s *Service) MemberCoaches(ctx context.Context) ([]*Row, error) {
	return s.repo.MemberCoaches(ctx, s.db)
}

// MemberCoach is an active coach with their published classes in the next
// 14 days; nil when not found.
func (s *Service) MemberCoach(ctx context.Context, customerID, id string) (*Row, error) {
	coach, err := s.repo.ActiveCoach(ctx, s.db, id)
	if err != nil || coach == nil {
		return nil, err
	}
	now := s.now()
	to := now.Add(14 * 24 * time.Hour)
	sessions, err := s.repo.ListSessions(ctx, s.db, SessionFilter{
		From: &now, To: &to, CoachID: &id, Statuses: bookableStatuses, CustomerID: &customerID,
	})
	if err != nil {
		return nil, err
	}
	coach.Set("sessions", sessions)
	return coach, nil
}

// Catalog backs the member app: active branches, class types, the class
// types each credit package covers (archived packages too, old lots still
// point at them), and each coach's branch.
func (s *Service) Catalog(ctx context.Context) (*Row, error) {
	branches, classTypes, coaches, err := s.repo.Catalog(ctx, s.db)
	if err != nil {
		return nil, err
	}
	packages, err := s.Packages.Coverage(ctx, s.db)
	if err != nil {
		return nil, err
	}
	return object("branches", branches, "class_types", classTypes, "packages", packages, "coaches", coaches), nil
}
