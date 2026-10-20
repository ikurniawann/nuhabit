package gymdesk

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
)

// Service runs the desk reads and writes on db (the pool, or a transaction
// in tests).
type Service struct {
	db    database.DB
	ports Ports
	now   func() time.Time
}

// MemberFilter is the member list query.
type MemberFilter struct {
	Q string
	// ActivePass keeps members with a pass running now.
	ActivePass bool
	// HasCredits keeps members with a positive credit balance.
	HasCredits bool
	// Expiring keeps members with credits that lapse within ExpiringDays.
	Expiring bool
	// Inactive keeps members who visited before but not in InactiveDays.
	Inactive bool
	BranchID *string
	Page     int
	PageSize int
}

const (
	// ExpiringDays is the horizon of the "credits expiring" filter.
	ExpiringDays = 14
	// InactiveDays is the gap of the "inactive" filter.
	InactiveDays = 30
)

// MemberRow is one row of the member list.
type MemberRow struct {
	ID              string     `json:"id"`
	Name            *string    `json:"name"`
	Phone           string     `json:"phone"`
	Email           *string    `json:"email"`
	MemberCode      *string    `json:"member_code"`
	IsActive        bool       `json:"is_active"`
	PassUntil       *time.Time `json:"pass_until"`
	PassName        *string    `json:"pass_name"`
	Balance         int        `json:"balance"`
	LastVisit       *time.Time `json:"last_visit"`
	UpcomingBooking int        `json:"bookings_next_7_days"`
}

// MemberPage is one page of the member list.
type MemberPage struct {
	Rows     []MemberRow `json:"rows"`
	Total    int         `json:"total"`
	Page     int         `json:"page"`
	PageSize int         `json:"page_size"`
}

var nonDigit = regexp.MustCompile(`\D`)

// likePattern is %term% with the LIKE wildcards in term escaped.
func likePattern(term string) string {
	return "%" + strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(term) + "%"
}

// phoneCore is the digits of a phone-like term without the 0 or 62 prefix,
// so 0812…, 62812… and +62 812… find the same member; "" when the term has
// fewer than four digits.
func phoneCore(term string) string {
	digits := nonDigit.ReplaceAllString(term, "")
	if len(digits) < 4 {
		return ""
	}
	switch {
	case strings.HasPrefix(digits, "62"):
		return digits[2:]
	case strings.HasPrefix(digits, "0"):
		return digits[1:]
	}
	return digits
}

// lotRemainders lists every credit lot of the members who hold a lot that
// lapses in (from, to], with the credits left on it; from and to are
// placeholders such as "$1". It is the FIFO rule of gym-credits
// (domain.LotRemainders) in SQL: debits pinned to a lot come off that lot,
// the rest of the usage is taken from lots in expiry order.
func lotRemainders(from, to string) string {
	return `
  WITH cand AS (
    SELECT DISTINCT customer_id FROM gym.credit_lots WHERE expires_at > ` + from + ` AND expires_at <= ` + to + `
  ), entries AS (
    SELECT e.customer_id, e.lot_id, e.amount,
           (e.amount < 0 AND e.lot_id IS NOT NULL AND e.type IN ('expiration', 'reversal')) AS pinned,
           (e.amount > 0 AND e.lot_id IS NOT NULL) AS owns_lot
      FROM gym.credit_ledger e JOIN cand USING (customer_id)
  ), pinned AS (
    SELECT lot_id, sum(-amount) AS credits FROM entries WHERE pinned GROUP BY lot_id
  ), pool AS (
    SELECT customer_id, greatest(0, sum(-amount)) AS consumed
      FROM entries WHERE NOT pinned AND NOT owns_lot GROUP BY customer_id
  ), lots AS (
    SELECT l.id, l.customer_id, l.package_id, l.expires_at, l.created_at,
           greatest(0, l.credits - COALESCE(p.credits, 0)) AS available
      FROM gym.credit_lots l JOIN cand USING (customer_id) LEFT JOIN pinned p ON p.lot_id = l.id
  ), ordered AS (
    SELECT lots.*, COALESCE(sum(available) OVER (PARTITION BY customer_id ORDER BY expires_at, created_at, id
                                                 ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) AS before
      FROM lots
  )
  SELECT o.id, o.customer_id, o.package_id, o.expires_at,
         (o.available - least(o.available, greatest(0, COALESCE(pool.consumed, 0) - o.before)))::int AS remaining
    FROM ordered o LEFT JOIN pool USING (customer_id)`
}

// memberWhere builds the WHERE clause of the member list; args start at $1.
func memberWhere(f MemberFilter, now time.Time) (string, []any) {
	var conds []string
	args := []any{}
	arg := func(v any) string {
		args = append(args, v)
		return fmt.Sprintf("$%d", len(args))
	}
	if f.Expiring {
		from, to := arg(now), arg(now.AddDate(0, 0, ExpiringDays))
		conds = append(conds, fmt.Sprintf(`c.id IN (SELECT r.customer_id FROM (%s) r
			WHERE r.remaining > 0 AND r.expires_at > %s AND r.expires_at <= %s)`, lotRemainders(from, to), from, to))
	}
	if q := strings.TrimSpace(f.Q); q != "" {
		like := arg(likePattern(q))
		match := fmt.Sprintf(`c.name ILIKE %[1]s OR c.email ILIKE %[1]s OR c.phone ILIKE %[1]s OR p.member_code ILIKE %[1]s`, like)
		if core := phoneCore(q); core != "" {
			match += fmt.Sprintf(` OR regexp_replace(COALESCE(c.phone, ''), '\D', '', 'g') LIKE %s`, arg("%"+core+"%"))
		}
		conds = append(conds, "("+match+")")
	}
	if f.ActivePass {
		conds = append(conds, fmt.Sprintf(`EXISTS (SELECT 1 FROM gym.member_passes mp
			WHERE mp.customer_id = c.id AND mp.status = 'active' AND mp.ends_at > %s)`, arg(now)))
	}
	if f.HasCredits {
		conds = append(conds, `c.id IN (SELECT l.customer_id FROM gym.credit_ledger l GROUP BY l.customer_id HAVING sum(l.amount) > 0)`)
	}
	if f.Inactive {
		conds = append(conds, fmt.Sprintf(`EXISTS (SELECT 1 FROM gym.access_logs a WHERE a.customer_id = c.id AND a.decision = 'allowed')
			AND NOT EXISTS (SELECT 1 FROM gym.access_logs a
			                 WHERE a.customer_id = c.id AND a.decision = 'allowed' AND a.created_at >= %s)`,
			arg(now.AddDate(0, 0, -InactiveDays))))
	}
	if f.BranchID != nil {
		branch := arg(*f.BranchID)
		conds = append(conds, fmt.Sprintf(`(EXISTS (SELECT 1 FROM gym.bookings b JOIN gym.class_sessions s ON s.id = b.session_id
			          WHERE b.customer_id = c.id AND s.branch_id = %[1]s)
			OR EXISTS (SELECT 1 FROM gym.credit_purchases cp WHERE cp.customer_id = c.id AND cp.branch_id = %[1]s))`, branch))
	}
	if len(conds) == 0 {
		return "", args
	}
	return " WHERE " + strings.Join(conds, " AND "), args
}

// ListMembers is one page of the member list, ordered by name.
func (s *Service) ListMembers(ctx context.Context, f MemberFilter) (*MemberPage, error) {
	now := s.now()
	where, args := memberWhere(f, now)
	from := ` FROM pos.pos_customers c LEFT JOIN crm.crm_member_profiles p ON p.customer_id = c.id` + where
	out := &MemberPage{Rows: []MemberRow{}, Page: f.Page, PageSize: f.PageSize}
	if err := s.db.QueryRow(ctx, `SELECT count(*)::int`+from, args...).Scan(&out.Total); err != nil {
		return nil, err
	}
	if out.Total == 0 {
		return out, nil
	}
	n := len(args)
	rows, err := s.db.Query(ctx, fmt.Sprintf(`
		WITH page AS (
		  SELECT c.id, c.name, c.phone, c.email, p.member_code, COALESCE(c.is_active, true) AS is_active
		  %s
		  ORDER BY lower(c.name) NULLS LAST, c.id
		  LIMIT $%d OFFSET $%d
		)
		SELECT page.id::text, page.name, page.phone, page.email, page.member_code, page.is_active,
		       pass.ends_at, pass.name, COALESCE(bal.balance, 0)::int, visit.at, COALESCE(nb.n, 0)::int
		  FROM page
		  LEFT JOIN LATERAL (
		    SELECT mp.ends_at, pk.name FROM gym.member_passes mp JOIN gym.credit_packages pk ON pk.id = mp.package_id
		     WHERE mp.customer_id = page.id AND mp.status = 'active' AND mp.ends_at > $%d
		     ORDER BY mp.ends_at DESC LIMIT 1) pass ON true
		  LEFT JOIN LATERAL (SELECT sum(amount) AS balance FROM gym.credit_ledger WHERE customer_id = page.id) bal ON true
		  LEFT JOIN LATERAL (
		    SELECT max(created_at) AS at FROM gym.access_logs WHERE customer_id = page.id AND decision = 'allowed') visit ON true
		  LEFT JOIN LATERAL (
		    SELECT count(*) AS n FROM gym.bookings b JOIN gym.class_sessions s ON s.id = b.session_id
		     WHERE b.customer_id = page.id AND b.status IN ('confirmed', 'waitlist')
		       AND s.starts_at >= $%d AND s.starts_at < $%d) nb ON true
		 ORDER BY lower(page.name) NULLS LAST, page.id`, from, n+1, n+2, n+3, n+3, n+4),
		append(args, f.PageSize, (f.Page-1)*f.PageSize, now, now.AddDate(0, 0, 7))...)
	if err != nil {
		return nil, err
	}
	out.Rows, err = pgx.CollectRows(rows, func(row pgx.CollectableRow) (MemberRow, error) {
		var m MemberRow
		err := row.Scan(&m.ID, &m.Name, &m.Phone, &m.Email, &m.MemberCode, &m.IsActive,
			&m.PassUntil, &m.PassName, &m.Balance, &m.LastVisit, &m.UpcomingBooking)
		return m, err
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

// Branch is a branch option of the filters.
type Branch struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// Branches lists the active branches by name.
func (s *Service) Branches(ctx context.Context) ([]Branch, error) {
	rows, err := s.db.Query(ctx, `SELECT id::text, name FROM configuration.branches WHERE COALESCE(is_active, true) ORDER BY name`)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[Branch])
}

// Register creates a member at the front desk.
func (s *Service) Register(ctx context.Context, m NewMember) (string, error) {
	return s.ports.Accounts.Register(ctx, s.db, m)
}

// UpdateProfile applies a staff edit of the member.
func (s *Service) UpdateProfile(ctx context.Context, customerID string, p ProfilePatch) error {
	return s.ports.Accounts.UpdateProfile(ctx, s.db, customerID, p)
}

/* ── Member 360 ────────────────────────────────────────────────────────── */

// Waiver is the member's waiver acceptance against the current text.
type Waiver struct {
	Version        *string    `json:"version"`
	AcceptedAt     *time.Time `json:"accepted_at"`
	CurrentVersion string     `json:"current_version"`
	Current        bool       `json:"current"`
}

// Profile is the identity and contact block of the 360 page.
type Profile struct {
	ID               string          `json:"id"`
	Name             *string         `json:"name"`
	Phone            string          `json:"phone"`
	Email            *string         `json:"email"`
	BirthDate        *string         `json:"birth_date"`
	Gender           *string         `json:"gender"`
	PhotoURL         *string         `json:"photo_url"`
	EmergencyContact json.RawMessage `json:"emergency_contact"`
	IsActive         bool            `json:"is_active"`
	JoinedAt         *time.Time      `json:"joined_at"`
	MembershipTier   *string         `json:"membership_tier"`
	MemberCode       *string         `json:"member_code"`
	// CRMMemberID is the id of the CRM member page: the CRM profile, or
	// "pos-<customer id>" for a member without one.
	CRMMemberID string `json:"crm_member_id"`
	Waiver      Waiver `json:"waiver"`
}

// Booking is a class booking of the member.
type Booking struct {
	ID               string     `json:"id"`
	SessionID        string     `json:"session_id"`
	Status           string     `json:"status"`
	WaitlistPosition *int       `json:"waitlist_position"`
	LateCancel       bool       `json:"late_cancel"`
	Source           string     `json:"source"`
	CheckedInAt      *time.Time `json:"checked_in_at"`
	StartsAt         time.Time  `json:"starts_at"`
	CreditCost       int        `json:"credit_cost"`
	ClassTypeName    string     `json:"class_type_name"`
	CoachName        *string    `json:"coach_name"`
	BranchName       *string    `json:"branch_name"`
}

// Attendance counts the member's settled bookings.
type Attendance struct {
	Attended   int `json:"attended"`
	NoShow     int `json:"no_show"`
	LateCancel int `json:"late_cancel"`
}

// Visit is one gate scan of the member.
type Visit struct {
	ID            string     `json:"id"`
	Decision      string     `json:"decision"`
	Reason        *string    `json:"reason"`
	EntryKind     *string    `json:"entry_kind"`
	CreditDelta   int        `json:"credit_delta"`
	Source        string     `json:"source"`
	CreatedAt     time.Time  `json:"created_at"`
	ClassTypeName *string    `json:"class_type_name"`
	StartsAt      *time.Time `json:"starts_at"`
}

// Member360 is everything the desk sees about one member.
type Member360 struct {
	Profile    Profile         `json:"profile"`
	Credits    json.RawMessage `json:"credits"`
	Attendance Attendance      `json:"attendance"`
	Upcoming   []Booking       `json:"upcoming_bookings"`
	Past       []Booking       `json:"past_bookings"`
	Visits     []Visit         `json:"checkins"`
	Notes      []Note          `json:"notes"`
}

const (
	upcomingLimit = 20
	pastLimit     = 50
	visitLimit    = 50
)

// Member360 loads the 360 page; nil when the member does not exist.
func (s *Service) Member360(ctx context.Context, customerID string) (*Member360, error) {
	profile, err := s.profile(ctx, customerID)
	if err != nil || profile == nil {
		return nil, err
	}
	now := s.now()
	out := &Member360{Profile: *profile}
	if out.Credits, err = s.ports.Credits.MemberCredits(ctx, customerID); err != nil {
		return nil, err
	}
	if err := s.db.QueryRow(ctx, `
		SELECT count(*) FILTER (WHERE b.status IN ('checked_in', 'completed'))::int,
		       count(*) FILTER (WHERE b.status = 'no_show')::int,
		       count(*) FILTER (WHERE b.status = 'cancelled' AND b.late_cancel)::int
		  FROM gym.bookings b WHERE b.customer_id = $1`, customerID).
		Scan(&out.Attendance.Attended, &out.Attendance.NoShow, &out.Attendance.LateCancel); err != nil {
		return nil, err
	}
	if out.Upcoming, err = s.bookings(ctx, customerID,
		`s.starts_at >= $2 AND b.status IN ('confirmed', 'waitlist') ORDER BY s.starts_at LIMIT $3`, now, upcomingLimit); err != nil {
		return nil, err
	}
	if out.Past, err = s.bookings(ctx, customerID,
		`s.starts_at < $2 ORDER BY s.starts_at DESC LIMIT $3`, now, pastLimit); err != nil {
		return nil, err
	}
	if out.Visits, err = s.visits(ctx, customerID); err != nil {
		return nil, err
	}
	if out.Notes, err = s.Notes(ctx, customerID); err != nil {
		return nil, err
	}
	return out, nil
}

func (s *Service) profile(ctx context.Context, customerID string) (*Profile, error) {
	var p Profile
	var profileID *string
	err := s.db.QueryRow(ctx, `
		SELECT c.id::text, c.name, c.phone, c.email, to_char(c.birth_date, 'YYYY-MM-DD'), c.gender, c.photo_url,
		       c.emergency_contact, COALESCE(c.is_active, true), c.created_at, c.membership_tier,
		       c.waiver_version, c.waiver_accepted_at, cp.id::text, cp.member_code
		  FROM pos.pos_customers c
		  LEFT JOIN crm.crm_member_profiles cp ON cp.customer_id = c.id
		 WHERE c.id = $1`, customerID).Scan(
		&p.ID, &p.Name, &p.Phone, &p.Email, &p.BirthDate, &p.Gender, &p.PhotoURL,
		&p.EmergencyContact, &p.IsActive, &p.JoinedAt, &p.MembershipTier,
		&p.Waiver.Version, &p.Waiver.AcceptedAt, &profileID, &p.MemberCode)
	if database.IsNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if p.EmergencyContact == nil {
		p.EmergencyContact = json.RawMessage("null")
	}
	p.CRMMemberID = "pos-" + p.ID
	if profileID != nil {
		p.CRMMemberID = *profileID
	}
	p.Waiver.CurrentVersion = s.ports.WaiverVersion
	p.Waiver.Current = p.Waiver.AcceptedAt != nil && p.Waiver.Version != nil && *p.Waiver.Version == s.ports.WaiverVersion
	return &p, nil
}

// bookings reads the member's bookings; tail filters on $2 and limits by $3.
func (s *Service) bookings(ctx context.Context, customerID, tail string, at time.Time, limit int) ([]Booking, error) {
	rows, err := s.db.Query(ctx, `
		SELECT b.id::text, b.session_id::text, b.status, b.waitlist_position, b.late_cancel, b.source, b.checked_in_at,
		       s.starts_at, s.credit_cost, t.name, co.name, br.name
		  FROM gym.bookings b
		  JOIN gym.class_sessions s ON s.id = b.session_id
		  JOIN gym.class_types t ON t.id = s.class_type_id
		  LEFT JOIN gym.coaches co ON co.id = s.coach_id
		  LEFT JOIN configuration.branches br ON br.id = s.branch_id
		 WHERE b.customer_id = $1 AND `+tail, customerID, at, limit)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[Booking])
}

func (s *Service) visits(ctx context.Context, customerID string) ([]Visit, error) {
	rows, err := s.db.Query(ctx, `
		SELECT l.id::text, l.decision, l.reason, l.entry_kind, l.credit_delta, l.source, l.created_at, t.name, s.starts_at
		  FROM gym.access_logs l
		  LEFT JOIN gym.bookings b ON b.id = l.booking_id
		  LEFT JOIN gym.class_sessions s ON s.id = b.session_id
		  LEFT JOIN gym.class_types t ON t.id = s.class_type_id
		 WHERE l.customer_id = $1
		 ORDER BY l.created_at DESC LIMIT $2`, customerID, visitLimit)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[Visit])
}

// requireMember is a 404 when the customer does not exist.
func (s *Service) requireMember(ctx context.Context, customerID string) error {
	var exists bool
	if err := s.db.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM pos.pos_customers WHERE id = $1)`, customerID).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return httpx.NotFound("Member tidak ditemukan")
	}
	return nil
}
