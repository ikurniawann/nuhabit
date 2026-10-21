package gymdesk

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/gymdesk/domain"
	"nuhabit/backend/internal/platform/members"
)

// Report queries filter on indexed time columns first (class_sessions
// starts_at, credit_purchases paid_at/refunded_at, access_logs created_at,
// pos_customers created_at, member_passes ends_at, credit_lots expires_at),
// then join by key.

// ClassReport is attendance, occupancy and coach utilisation over p.
func (s *Service) ClassReport(ctx context.Context, p domain.Period, branchID *string) (domain.ClassReport, error) {
	rows, err := s.db.Query(ctx, `
		SELECT s.id::text, s.class_type_id::text, t.name, s.coach_id::text, co.name, s.starts_at, s.ends_at, s.capacity,
		       count(b.id) FILTER (WHERE b.status IN ('confirmed', 'checked_in', 'completed', 'no_show'))::int,
		       count(b.id) FILTER (WHERE b.status IN ('checked_in', 'completed'))::int,
		       count(b.id) FILTER (WHERE b.status = 'no_show')::int,
		       count(b.id) FILTER (WHERE b.status = 'cancelled' AND b.late_cancel)::int,
		       count(b.id) FILTER (WHERE b.status <> 'waitlist')::int
		  FROM gym.class_sessions s
		  JOIN gym.class_types t ON t.id = s.class_type_id
		  LEFT JOIN gym.coaches co ON co.id = s.coach_id
		  LEFT JOIN gym.bookings b ON b.session_id = s.id
		 WHERE s.starts_at >= $1 AND s.starts_at < $2
		   AND s.status NOT IN ('draft', 'cancelled')
		   AND ($3::uuid IS NULL OR s.branch_id = $3)
		 GROUP BY s.id, t.name, co.name`, p.From, p.To, branchID)
	if err != nil {
		return domain.ClassReport{}, err
	}
	sessions, err := pgx.CollectRows(rows, pgx.RowToStructByPos[domain.SessionStat])
	if err != nil {
		return domain.ClassReport{}, err
	}
	return domain.RollUpClasses(sessions, p, s.now()), nil
}

// RevenueReport is package and pass sales over p.
func (s *Service) RevenueReport(ctx context.Context, p domain.Period, branchID *string) (domain.RevenueReport, error) {
	rows, err := s.db.Query(ctx, `
		SELECT to_char(cp.paid_at AT TIME ZONE $4, 'YYYY-MM-DD'), pk.id::text, pk.name, pk.kind,
		       COALESCE(cp.payment_method, 'lainnya'), COALESCE(cp.branch_id::text, ''), COALESCE(br.name, ''),
		       count(*)::int, sum(cp.total_idr)::float8
		  FROM gym.credit_purchases cp
		  JOIN gym.credit_packages pk ON pk.id = cp.package_id
		  LEFT JOIN configuration.branches br ON br.id = cp.branch_id
		 WHERE cp.paid_at >= $1 AND cp.paid_at < $2 AND cp.status IN ('paid', 'refunded')
		   AND ($3::uuid IS NULL OR cp.branch_id = $3)
		 GROUP BY 1, 2, 3, 4, 5, 6, 7`, p.From, p.To, branchID, p.ZoneName())
	if err != nil {
		return domain.RevenueReport{}, err
	}
	sales, err := pgx.CollectRows(rows, pgx.RowToStructByPos[domain.SaleRow])
	if err != nil {
		return domain.RevenueReport{}, err
	}
	rows, err = s.db.Query(ctx, `
		SELECT to_char(refunded_at AT TIME ZONE $4, 'YYYY-MM-DD'), count(*)::int, sum(total_idr)::float8
		  FROM gym.credit_purchases
		 WHERE refunded_at >= $1 AND refunded_at < $2 AND status = 'refunded'
		   AND ($3::uuid IS NULL OR branch_id = $3)
		 GROUP BY 1`, p.From, p.To, branchID, p.ZoneName())
	if err != nil {
		return domain.RevenueReport{}, err
	}
	refunds, err := pgx.CollectRows(rows, pgx.RowToStructByPos[domain.RefundRow])
	if err != nil {
		return domain.RevenueReport{}, err
	}
	return domain.RollUpRevenue(sales, refunds, p), nil
}

// MemberRef names a member in a report list.
type MemberRef struct {
	ID    string  `json:"id"`
	Name  *string `json:"name"`
	Phone string  `json:"phone"`
}

// ExpiringPass is a pass that ends within the horizon.
type ExpiringPass struct {
	MemberRef
	PackageName string    `json:"package_name"`
	EndsAt      time.Time `json:"ends_at"`
}

// ExpiringCredits are the credits of one member that lapse within the horizon.
type ExpiringCredits struct {
	MemberRef
	Credits   int       `json:"credits"`
	ExpiresAt time.Time `json:"expires_at"`
}

// ChurnedMember visited in the previous period and not in this one.
type ChurnedMember struct {
	MemberRef
	LastVisit time.Time `json:"last_visit"`
}

// MembersReport is member growth, activity and churn over p, and the passes
// and credits that lapse in the next ExpiryHorizonDays days.
type MembersReport struct {
	// Timezone is the zone the report's days read in.
	Timezone       string            `json:"timezone"`
	New            int               `json:"new_members"`
	NewPerDay      []DayCount        `json:"new_per_day"`
	Active         int               `json:"active_members"`
	PreviousActive int               `json:"previous_active_members"`
	Churned        int               `json:"churned_members"`
	ChurnRate      float64           `json:"churn_rate"`
	ChurnedList    []ChurnedMember   `json:"churned"`
	ExpiringPasses []ExpiringPass    `json:"expiring_passes"`
	ExpiringCredit []ExpiringCredits `json:"expiring_credits"`
}

// DayCount is a count on one day of the report zone.
type DayCount struct {
	Day   string `json:"day"`
	Count int    `json:"count"`
}

const (
	// ExpiryHorizonDays bounds the expiring lists; the page splits them at 14 and 30.
	ExpiryHorizonDays = 30
	reportListLimit   = 500
)

// visitorsCTEs defines cur and prev: the members allowed through the gate in
// [$1, $2) and in [$4, $5), at branch $3 (the scan's branch, else the booked
// class's branch), with their last visit.
const visitorsCTEs = `
  WITH visits AS (
    SELECT l.customer_id, l.created_at
      FROM gym.access_logs l
      LEFT JOIN gym.bookings b ON b.id = l.booking_id
      LEFT JOIN gym.class_sessions s ON s.id = b.session_id
     WHERE l.created_at >= $4 AND l.created_at < $2 AND l.decision = 'allowed' AND l.customer_id IS NOT NULL
       AND ($3::uuid IS NULL OR COALESCE(l.branch_id, s.branch_id) = $3)
  ), cur AS (
    SELECT customer_id FROM visits WHERE created_at >= $1 GROUP BY customer_id
  ), prev AS (
    SELECT customer_id, max(created_at) AS last_visit FROM visits WHERE created_at < $5 GROUP BY customer_id
  )`

// MembersReport builds the member report. New members and the expiring
// lists cover every branch; activity and churn follow the branch filter.
func (s *Service) MembersReport(ctx context.Context, p domain.Period, branchID *string) (*MembersReport, error) {
	out := &MembersReport{Timezone: p.ZoneName()}
	rows, err := s.db.Query(ctx, `
		SELECT to_char(created_at AT TIME ZONE $3, 'YYYY-MM-DD'), count(*)::int
		  FROM pos.pos_customers WHERE created_at >= $1 AND created_at < $2 GROUP BY 1`, p.From, p.To, p.ZoneName())
	if err != nil {
		return nil, err
	}
	counts, err := pgx.CollectRows(rows, pgx.RowToStructByPos[DayCount])
	if err != nil {
		return nil, err
	}
	byDay := map[string]int{}
	for _, c := range counts {
		byDay[c.Day] = c.Count
		out.New += c.Count
	}
	for _, day := range p.DayKeys() {
		out.NewPerDay = append(out.NewPerDay, DayCount{Day: day, Count: byDay[day]})
	}

	prev := p.Previous()
	if err := s.db.QueryRow(ctx, visitorsCTEs+`
		SELECT (SELECT count(*) FROM cur)::int, (SELECT count(*) FROM prev)::int,
		       (SELECT count(*) FROM prev WHERE customer_id NOT IN (SELECT customer_id FROM cur))::int`,
		p.From, p.To, branchID, prev.From, prev.To).Scan(&out.Active, &out.PreviousActive, &out.Churned); err != nil {
		return nil, err
	}
	out.ChurnRate = domain.Rate(out.Churned, out.PreviousActive)

	rows, err = s.db.Query(ctx, visitorsCTEs+`
		SELECT c.id::text, c.name, c.phone, prev.last_visit
		  FROM prev JOIN pos.pos_customers c ON c.id = prev.customer_id
		 WHERE prev.customer_id NOT IN (SELECT customer_id FROM cur)
		 ORDER BY prev.last_visit DESC LIMIT $6`, p.From, p.To, branchID, prev.From, prev.To, reportListLimit)
	if err != nil {
		return nil, err
	}
	if out.ChurnedList, err = pgx.CollectRows(rows, func(row pgx.CollectableRow) (ChurnedMember, error) {
		var m ChurnedMember
		return m, row.Scan(&m.ID, &m.Name, &m.Phone, &m.LastVisit)
	}); err != nil {
		return nil, err
	}

	now := s.now()
	horizon := now.AddDate(0, 0, ExpiryHorizonDays)
	rows, err = s.db.Query(ctx, `
		SELECT c.id::text, c.name, c.phone, pk.name, mp.ends_at
		  FROM gym.member_passes mp
		  JOIN pos.pos_customers c ON c.id = mp.customer_id
		  JOIN gym.credit_packages pk ON pk.id = mp.package_id
		 WHERE mp.status = 'active' AND mp.ends_at > $1 AND mp.ends_at <= $2
		 ORDER BY mp.ends_at LIMIT $3`, now, horizon, reportListLimit)
	if err != nil {
		return nil, err
	}
	if out.ExpiringPasses, err = pgx.CollectRows(rows, func(row pgx.CollectableRow) (ExpiringPass, error) {
		var m ExpiringPass
		return m, row.Scan(&m.ID, &m.Name, &m.Phone, &m.PackageName, &m.EndsAt)
	}); err != nil {
		return nil, err
	}

	expiring, err := s.ports.Credits.Expiring(ctx, s.db, now, ExpiryHorizonDays)
	if err != nil {
		return nil, err
	}
	expiring = expiring[:min(len(expiring), reportListLimit)]
	ids := make([]string, len(expiring))
	for i, e := range expiring {
		ids[i] = e.CustomerID
	}
	refs, err := members.GetMany(ctx, s.db, ids)
	if err != nil {
		return nil, err
	}
	out.ExpiringCredit = make([]ExpiringCredits, 0, len(expiring))
	for _, e := range expiring {
		m := refs[e.CustomerID]
		out.ExpiringCredit = append(out.ExpiringCredit, ExpiringCredits{
			MemberRef: MemberRef{ID: e.CustomerID, Name: m.Name, Phone: m.Phone}, Credits: e.Credits, ExpiresAt: e.ExpiresAt,
		})
	}
	return out, nil
}
