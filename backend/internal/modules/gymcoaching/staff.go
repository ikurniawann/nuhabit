package gymcoaching

import (
	"context"
	"time"

	"nuhabit/backend/internal/platform/httpx"
)

// Staff side of PT requests: the coach's inbox row and the pending count
// the dashboard badge and the PT page strip poll.

// PendingLink is the dashboard page a request notice opens.
const PendingLink = "/dashboard/gym/pt?status=requested"

// CoachContact is the staff account linked to a coach.
type CoachContact struct {
	UserID string
	Email  *string
	Phone  *string
}

// LookupCoachContact reads the active staff account of a coach, nil when the
// coach has none. The phone comes from the employee record of that account.
func LookupCoachContact(ctx context.Context, q Q, coachID string) (*CoachContact, error) {
	var c CoachContact
	err := q.QueryRow(ctx, `SELECT u.id::text, u.email, e.phone
       FROM gym.coaches c
       JOIN configuration.users u ON u.id = c.user_id AND u.status = 'active'
       LEFT JOIN hris.employees e ON e.user_id = u.id
      WHERE c.id = $1
      LIMIT 1`, coachID).Scan(&c.UserID, &c.Email, &c.Phone)
	if isNoRows(err) {
		return nil, nil
	}
	return &c, err
}

// StaffInboxSQL writes a coach notice to the dashboard inbox
// (public.notifications, the bell every staff screen shows).
type StaffInboxSQL struct{}

var _ StaffNotifier = StaffInboxSQL{}

func (StaffInboxSQL) NotifyCoach(ctx context.Context, q Q, coachID string, n Notification) error {
	contact, err := LookupCoachContact(ctx, q, coachID)
	if err != nil || contact == nil {
		return err
	}
	return InboxNotice(ctx, q, contact.UserID, n)
}

// InboxNotice writes n to the dashboard inbox of the staff account userID.
func InboxNotice(ctx context.Context, q Q, userID string, n Notification) error {
	kind := "status_change"
	if n.Type == "gym_pt_requested" {
		kind = "approval"
	}
	_, err := q.Exec(ctx, `INSERT INTO public.notifications (user_id, title, message, type, link, metadata)
       VALUES ($1, $2, $3, $4, $5, jsonb_build_object('gym_type', $6::text))`,
		userID, n.Title, n.Body, kind, PendingLink, n.Type)
	return err
}

// Pending is the count of PT requests waiting for a coach.
type Pending struct {
	Count int `json:"count"`
	// EarliestStart is the start of the oldest-starting request, nil when none.
	EarliestStart *httpx.JSTime `json:"earliest_start"`
}

// PendingRequests counts the requested sessions still ahead, of one coach
// when coachID is set.
func (s *Service) PendingRequests(ctx context.Context, coachID string) (Pending, error) {
	var out Pending
	var earliest *time.Time
	err := s.db.QueryRow(ctx, `SELECT count(*)::int, min(starts_at) FROM gym.pt_appointments
      WHERE status = 'requested' AND starts_at > $1 AND ($2::uuid IS NULL OR coach_id = $2)`,
		s.now(), nullable(coachID)).Scan(&out.Count, &earliest)
	out.EarliestStart = httpx.NewJSTime(earliest)
	return out, err
}
