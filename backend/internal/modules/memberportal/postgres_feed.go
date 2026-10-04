package memberportal

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/memberportal/domain"
	"nuhabit/backend/internal/platform/database"
)

// Notification is a member inbox row.
type Notification struct {
	ID        string  `json:"id"`
	Type      string  `json:"type"`
	Title     string  `json:"title"`
	Body      string  `json:"body"`
	ImageURL  *string `json:"image_url"`
	LinkURL   *string `json:"link_url"`
	CreatedAt jsTime  `json:"created_at"`
	ReadAt    jsTime  `json:"read_at"`
}

func (s *store) Notifications(ctx context.Context, customerID string) ([]Notification, error) {
	rows, err := s.q.Query(ctx,
		`SELECT id, type, title, body, image_url, link_url, created_at, read_at
		   FROM crm.member_notifications WHERE customer_id = $1
		  ORDER BY created_at DESC LIMIT 50`, customerID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (Notification, error) {
		var n Notification
		err := row.Scan(&n.ID, &n.Type, &n.Title, &n.Body, &n.ImageURL, &n.LinkURL, &n.CreatedAt, &n.ReadAt)
		return n, err
	})
}

func (s *store) UnreadCount(ctx context.Context, customerID string) (int, error) {
	var n int
	err := s.q.QueryRow(ctx,
		`SELECT count(*)::int FROM crm.member_notifications WHERE customer_id = $1 AND read_at IS NULL`,
		customerID).Scan(&n)
	return n, err
}

// MarkRead marks the given notifications read, or all of them when ids is nil.
func (s *store) MarkRead(ctx context.Context, customerID string, ids []string) error {
	_, err := s.q.Exec(ctx,
		`UPDATE crm.member_notifications SET read_at = now()
		  WHERE customer_id = $1 AND read_at IS NULL AND ($2::uuid[] IS NULL OR id = ANY($2))`,
		customerID, ids)
	return err
}

// TrackNotification stamps the first open (and click); found is false when
// the notification is not the member's.
func (s *store) TrackNotification(ctx context.Context, customerID, id, event string) (link *string, found bool, err error) {
	err = s.q.QueryRow(ctx,
		`UPDATE crm.member_notifications
		    SET opened_at = COALESCE(opened_at, now()),
		        clicked_at = CASE WHEN $3 = 'click' THEN COALESCE(clicked_at, now()) ELSE clicked_at END
		  WHERE id = $1 AND customer_id = $2
		  RETURNING link_url`, id, customerID, event).Scan(&link)
	if database.IsNoRows(err) {
		return nil, false, nil
	}
	return link, err == nil, err
}

// InsertNotification writes one inbox row (notifyMember).
func (s *store) InsertNotification(ctx context.Context, customerID, kind, title, body string) error {
	_, err := s.q.Exec(ctx,
		`INSERT INTO crm.member_notifications (customer_id, type, title, body) VALUES ($1, $2, $3, $4)`,
		customerID, kind, title, body)
	return err
}

func (s *store) PushDeviceCount(ctx context.Context, customerID string) (int, error) {
	var n int
	err := s.q.QueryRow(ctx,
		`SELECT count(*)::int FROM crm.member_push_subscriptions WHERE customer_id = $1`, customerID).Scan(&n)
	return n, err
}

// SavePushSubscription upserts by endpoint; a device that changes hands
// moves to the new member.
func (s *store) SavePushSubscription(ctx context.Context, customerID, endpoint, p256dh, auth string, userAgent *string) error {
	_, err := s.q.Exec(ctx,
		`INSERT INTO crm.member_push_subscriptions (customer_id, endpoint, p256dh, auth, user_agent)
		 VALUES ($1, $2, $3, $4, $5)
		 ON CONFLICT (endpoint) DO UPDATE SET
		   customer_id = EXCLUDED.customer_id, p256dh = EXCLUDED.p256dh,
		   auth = EXCLUDED.auth, user_agent = EXCLUDED.user_agent`,
		customerID, endpoint, p256dh, auth, userAgent)
	return err
}

func (s *store) DeletePushSubscription(ctx context.Context, customerID, endpoint string) error {
	_, err := s.q.Exec(ctx,
		`DELETE FROM crm.member_push_subscriptions WHERE customer_id = $1 AND endpoint = $2`, customerID, endpoint)
	return err
}

// MemberQR is a freshly issued check-in QR.
type MemberQR struct {
	Token      string `json:"token"`
	IssuedAt   jsTime `json:"issued_at"`
	ExpiresAt  jsTime `json:"expires_at"`
	TTLSeconds int    `json:"ttl_seconds"`
}

// IssueQR stores a random single-use token valid for 60 seconds, then
// prunes day-old tokens in passing.
func (s *store) IssueQR(ctx context.Context, customerID string) (*MemberQR, error) {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return nil, err
	}
	token := domain.QRTokenPrefix + strings.ToLower(base64.RawURLEncoding.EncodeToString(b[:]))
	qr := MemberQR{TTLSeconds: domain.QRTTLSeconds}
	err := s.q.QueryRow(ctx,
		`INSERT INTO crm.member_qr_tokens (token, customer_id, expires_at)
		 VALUES ($1, $2, now() + make_interval(secs => $3))
		 RETURNING token, issued_at, expires_at`, token, customerID, domain.QRTTLSeconds).Scan(
		&qr.Token, &qr.IssuedAt, &qr.ExpiresAt)
	if err != nil {
		return nil, err
	}
	_, _ = s.q.Exec(ctx, `DELETE FROM crm.member_qr_tokens WHERE expires_at < now() - interval '1 day'`)
	return &qr, nil
}

// AnnouncementRow is a member announcement.
type AnnouncementRow struct {
	ID        string
	Title     string
	Body      string
	LinkURL   *string
	ImageURL  *string
	CreatedAt time.Time
}

func scanAnnouncements(rows pgx.Rows) ([]AnnouncementRow, error) {
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (AnnouncementRow, error) {
		var a AnnouncementRow
		err := row.Scan(&a.ID, &a.Title, &a.Body, &a.LinkURL, &a.ImageURL, &a.CreatedAt)
		return a, err
	})
}

// LatestAnnouncements are the member's 4 newest announcements.
func (s *store) LatestAnnouncements(ctx context.Context, customerID string) ([]AnnouncementRow, error) {
	rows, err := s.q.Query(ctx,
		`SELECT a.id, a.title, a.body, a.link_url, a.image_url, COALESCE(a.sent_at, a.created_at)
		   FROM crm.member_notifications n
		   JOIN crm.member_announcements a ON a.id = n.announcement_id
		  WHERE n.customer_id = $1
		  ORDER BY n.created_at DESC
		  LIMIT 4`, customerID)
	if err != nil {
		return nil, err
	}
	return scanAnnouncements(rows)
}

// Announcement returns one announcement only if the member received it.
func (s *store) Announcement(ctx context.Context, customerID, id string) (*AnnouncementRow, error) {
	rows, err := s.q.Query(ctx,
		`SELECT a.id, a.title, a.body, a.link_url, a.image_url, COALESCE(a.sent_at, a.created_at)
		   FROM crm.member_announcements a
		  WHERE a.id = $2
		    AND EXISTS (SELECT 1 FROM crm.member_notifications n WHERE n.announcement_id = a.id AND n.customer_id = $1)`,
		customerID, id)
	if err != nil {
		return nil, err
	}
	list, err := scanAnnouncements(rows)
	if err != nil || len(list) == 0 {
		return nil, err
	}
	return &list[0], nil
}

// AppAccount is the pos_customers part of GET /app/home/me.
type AppAccount struct {
	ID               string
	Name             *string
	Email            *string
	Phone            string
	PhotoURL         *string
	IsActive         *bool
	CreatedAt        *time.Time
	EmergencyContact json.RawMessage
	WaiverVersion    *string
	WaiverAcceptedAt *time.Time
}

func (s *store) AppAccount(ctx context.Context, customerID string) (*AppAccount, error) {
	var a AppAccount
	err := s.q.QueryRow(ctx,
		`SELECT id, name, email, phone, photo_url, is_active, created_at,
		        emergency_contact, waiver_version, waiver_accepted_at
		   FROM pos.pos_customers WHERE id = $1`, customerID).Scan(
		&a.ID, &a.Name, &a.Email, &a.Phone, &a.PhotoURL, &a.IsActive, &a.CreatedAt,
		&a.EmergencyContact, &a.WaiverVersion, &a.WaiverAcceptedAt)
	if database.IsNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &a, nil
}

// SaveAccount writes the emergency contact and/or accepts the waiver.
func (s *store) SaveAccount(ctx context.Context, customerID string, setContact bool, contact []byte, acceptWaiver bool, waiverVersion string) error {
	var contactArg any
	if contact != nil {
		contactArg = string(contact)
	}
	_, err := s.q.Exec(ctx,
		`UPDATE pos.pos_customers
		    SET emergency_contact = CASE WHEN $2 THEN $3::jsonb ELSE emergency_contact END,
		        waiver_version = CASE WHEN $4 THEN $5 ELSE waiver_version END,
		        waiver_accepted_at = CASE WHEN $4 THEN now() ELSE waiver_accepted_at END,
		        updated_at = now()
		  WHERE id = $1`, customerID, setContact, contactArg, acceptWaiver, waiverVersion)
	return err
}

// GymBookingRow is an active class booking of the member.
type GymBookingRow struct {
	ID               string
	Status           string
	WaitlistPosition *int
	SessionID        string
	ClassTypeID      string
	StartsAt         time.Time
	EndsAt           time.Time
	CreditCost       int
	Area             *string
	ClassTypeName    string
	BranchName       *string
}

// ActiveGymBookings are confirmed, waitlisted or checked-in bookings whose
// class has not passed the check-in window.
func (s *store) ActiveGymBookings(ctx context.Context, customerID string, lateMinutes int) ([]GymBookingRow, error) {
	rows, err := s.q.Query(ctx,
		`SELECT b.id, b.status, b.waitlist_position,
		        s.id, s.class_type_id, s.starts_at, s.ends_at, s.credit_cost, s.area,
		        t.name, br.name
		   FROM gym.bookings b
		   JOIN gym.class_sessions s ON s.id = b.session_id
		   JOIN gym.class_types t ON t.id = s.class_type_id
		   LEFT JOIN configuration.branches br ON br.id = s.branch_id
		  WHERE b.customer_id = $1
		    AND b.status IN ('confirmed', 'waitlist', 'checked_in')
		    AND s.ends_at >= now() - make_interval(mins => $2)
		  ORDER BY s.starts_at
		  LIMIT 50`, customerID, lateMinutes)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (GymBookingRow, error) {
		var b GymBookingRow
		err := row.Scan(&b.ID, &b.Status, &b.WaitlistPosition, &b.SessionID, &b.ClassTypeID, &b.StartsAt,
			&b.EndsAt, &b.CreditCost, &b.Area, &b.ClassTypeName, &b.BranchName)
		return b, err
	})
}

// GateVisitRow is one gate scan of the member.
type GateVisitRow struct {
	ID            string
	Decision      string
	Reason        *string
	CreditDelta   int
	CreatedAt     time.Time
	ClassTypeName *string
	BranchName    *string
}

func (s *store) GateVisits(ctx context.Context, customerID string) ([]GateVisitRow, error) {
	rows, err := s.q.Query(ctx,
		`SELECT l.id, l.decision, l.reason, l.credit_delta, l.created_at, t.name, br.name
		   FROM gym.access_logs l
		   LEFT JOIN gym.bookings b ON b.id = l.booking_id
		   LEFT JOIN gym.class_sessions s ON s.id = b.session_id
		   LEFT JOIN gym.class_types t ON t.id = s.class_type_id
		   LEFT JOIN configuration.branches br ON br.id = l.branch_id
		  WHERE l.customer_id = $1
		  ORDER BY l.created_at DESC
		  LIMIT 100`, customerID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (GateVisitRow, error) {
		var v GateVisitRow
		err := row.Scan(&v.ID, &v.Decision, &v.Reason, &v.CreditDelta, &v.CreatedAt, &v.ClassTypeName, &v.BranchName)
		return v, err
	})
}

// HomeSession is a class session on the home rail.
type HomeSession struct {
	ID            string
	ClassTypeID   string
	ClassTypeName string
	CoachName     *string
	BranchID      *string
	Area          *string
	StartsAt      time.Time
	SeatsLeft     int
	MyBooking     *string // status of the member's live booking
}

// UpcomingSessions lists published/full sessions in [from, to) with the
// member's booking (listSessions in lib/gym/session-queries).
func (s *store) UpcomingSessions(ctx context.Context, customerID string, from, to time.Time) ([]HomeSession, error) {
	rows, err := s.q.Query(ctx,
		`SELECT x.id, x.class_type_id, x.class_type_name, x.coach_name, x.branch_id, x.area, x.starts_at,
		        GREATEST(x.capacity - COALESCE(k.confirmed, 0), 0)::int AS seats_left,
		        mine.status
		   FROM (SELECT s.id, s.class_type_id, t.name AS class_type_name, c.name AS coach_name,
		                s.branch_id, s.area, s.starts_at, s.capacity
		           FROM gym.class_sessions s
		           JOIN gym.class_types t ON t.id = s.class_type_id
		           LEFT JOIN gym.coaches c ON c.id = s.coach_id
		          WHERE s.starts_at >= $1 AND s.starts_at < $2
		            AND s.status = ANY ($3)
		          ORDER BY s.starts_at
		          LIMIT 500) x
		   LEFT JOIN LATERAL (
		     SELECT count(*) FILTER (WHERE b.status IN ('confirmed', 'checked_in', 'completed')) AS confirmed
		       FROM gym.bookings b WHERE b.session_id = x.id
		   ) k ON true
		   LEFT JOIN LATERAL (
		     SELECT b.status FROM gym.bookings b
		      WHERE b.session_id = x.id AND b.customer_id = $4 AND b.status <> 'cancelled'
		      ORDER BY b.created_at DESC LIMIT 1
		   ) mine ON true
		  ORDER BY x.starts_at`, from, to, []string{"published", "full"}, customerID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (HomeSession, error) {
		var h HomeSession
		err := row.Scan(&h.ID, &h.ClassTypeID, &h.ClassTypeName, &h.CoachName, &h.BranchID, &h.Area,
			&h.StartsAt, &h.SeatsLeft, &h.MyBooking)
		return h, err
	})
}

func (s *store) BranchNames(ctx context.Context, ids []string) (map[string]string, error) {
	out := map[string]string{}
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := s.q.Query(ctx, `SELECT id, name FROM configuration.branches WHERE id = ANY($1)`, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id, name string
		if err := rows.Scan(&id, &name); err != nil {
			return nil, err
		}
		out[id] = name
	}
	return out, rows.Err()
}

// SpotlightRace is the next race, preferring one the member trains for.
type SpotlightRace struct {
	ID       string
	Name     string
	City     string
	ImageURL *string
	StartsAt time.Time
	GoalSec  *int
	Joined   bool
}

func (s *store) SpotlightRace(ctx context.Context, customerID string) (*SpotlightRace, error) {
	var r SpotlightRace
	err := s.q.QueryRow(ctx,
		`SELECT e.id, e.name, e.city, e.image_url, e.starts_at, r.goal_sec, (r.id IS NOT NULL) AS joined
		   FROM gym.race_events e
		   LEFT JOIN gym.member_races r
		     ON r.race_event_id = e.id AND r.customer_id = $1 AND r.status = 'training'
		  WHERE e.status NOT IN ('completed', 'cancelled') AND e.starts_at >= now()
		  ORDER BY (r.id IS NULL), e.starts_at
		  LIMIT 1`, customerID).Scan(&r.ID, &r.Name, &r.City, &r.ImageURL, &r.StartsAt, &r.GoalSec, &r.Joined)
	if database.IsNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &r, nil
}
