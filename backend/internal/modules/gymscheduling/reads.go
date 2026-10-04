package gymscheduling

import (
	"context"
	"encoding/json"
	"time"

	"nuhabit/backend/internal/modules/gymscheduling/domain"
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

// AccessLog is the last 100 gym scans plus today's (WIB) totals.
func (s *Service) AccessLog(ctx context.Context) (*Row, error) {
	log, today, err := s.repo.AccessLog(ctx, s.db)
	if err != nil {
		return nil, err
	}
	return object("log", log, "today", today), nil
}

// SearchBookableMembers finds members by name or phone, with their balance.
func (s *Service) SearchBookableMembers(ctx context.Context, term string) ([]MemberHit, error) {
	if utf16Len(term) < 2 {
		return []MemberHit{}, nil
	}
	hits, err := s.Members.Search(ctx, s.db, term)
	if err != nil {
		return nil, err
	}
	for i := range hits {
		if hits[i].Credits, err = s.Credits.GetBalance(ctx, s.db, hits[i].ID); err != nil {
			return nil, err
		}
	}
	return hits, nil
}

// cancelInfo is the member portal's cancel preview: the free deadline and
// what cancelling now would forfeit.
type cancelInfo struct {
	Deadline       jsTime              `json:"deadline"`
	Late           bool                `json:"late"`
	PenaltyCredits int                 `json:"penalty_credits"`
	Policy         domain.CreditPolicy `json:"policy"`
}

// myBookingStatus reads my_booking.status from a session row.
func myBookingStatus(r *Row) domain.BookingStatus {
	raw, ok := r.Get("my_booking").(json.RawMessage)
	if !ok {
		return ""
	}
	var mine struct {
		Status domain.BookingStatus `json:"status"`
	}
	_ = json.Unmarshal(raw, &mine)
	return mine.Status
}

func bookingStatusColumn(r *Row) domain.BookingStatus { return domain.BookingStatus(r.Str("status")) }

// attachCancelInfo adds cancel_info to each row: null unless the member's
// booking is confirmed. Rules are read once per branch.
func (s *Service) attachCancelInfo(ctx context.Context, rows []*Row, status func(*Row) domain.BookingStatus, now time.Time) error {
	rulesFor := s.branchRules(s.db)
	for _, r := range rows {
		st := status(r)
		if st != domain.BookingConfirmed {
			r.Set("cancel_info", nil)
			continue
		}
		rules, err := rulesFor(ctx, r.StrPtr("branch_id"))
		if err != nil {
			return err
		}
		out := domain.EvaluateCancellation(st, r.Time("starts_at"), r.Int("credit_cost"), rules, now)
		r.Set("cancel_info", cancelInfo{
			Deadline: jsTime(out.Deadline), Late: out.Late, PenaltyCredits: out.PenaltyCredits, Policy: rules.LateCancelPolicy,
		})
	}
	return nil
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
	if err := s.attachCancelInfo(ctx, sessions, myBookingStatus, now); err != nil {
		return nil, err
	}
	credits, err := s.Credits.GetBalance(ctx, s.db, customerID)
	if err != nil {
		return nil, err
	}
	classTypes, err := s.repo.ActiveClassTypes(ctx, s.db)
	if err != nil {
		return nil, err
	}
	return object("sessions", sessions, "credits", credits, "class_types", classTypes), nil
}

// MemberSession is one class with description, coach profile and cancel
// preview; nil for a missing or draft session.
func (s *Service) MemberSession(ctx context.Context, customerID, id string) (*Row, error) {
	session, err := s.GetSession(ctx, id, &customerID)
	if err != nil || session == nil || session.Str("status") == string(domain.SessionDraft) {
		return nil, err
	}
	if err := s.attachCancelInfo(ctx, []*Row{session}, myBookingStatus, s.now()); err != nil {
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
	return rows, s.attachCancelInfo(ctx, rows, bookingStatusColumn, s.now())
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
