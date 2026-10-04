package ticketing

import (
	"context"

	"nuhabit/backend/internal/modules/ticketing/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
)

// Daily venue capacity (capacity-server.ts). Writes run under the same
// transactional advisory lock the TS takes, keyed by the branch id and the
// visit date as text, so a Go registration and a TS booking for one date
// queue behind each other and the venue cannot be oversold.

// acquireCapacityLock is acquireCapacityLock.
func acquireCapacityLock(ctx context.Context, q database.Querier, v Venue, date string) error {
	_, err := q.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))`, v.BranchID, date)
	return err
}

// loadEffectiveCapacity resolves the capacity for date (nil = unlimited).
func loadEffectiveCapacity(ctx context.Context, q database.Querier, v Venue, date string) (*int, error) {
	var venueDefault *int
	err := q.QueryRow(ctx, `SELECT daily_capacity FROM ticketing.ticket_settings
		WHERE branch_id = $1 AND company_id = $2`, v.BranchID, v.CompanyID).Scan(&venueDefault)
	if err != nil && !database.IsNoRows(err) {
		return nil, err
	}
	overrides, err := capacityOverrides(ctx, q, v, date, date)
	if err != nil {
		return nil, err
	}
	capacity, _ := domain.ResolveDailyCapacity(date, venueDefault, overrides)
	return capacity, nil
}

func capacityOverrides(ctx context.Context, q database.Querier, v Venue, from, to string) ([]domain.CapacityDateRange, error) {
	var out []domain.CapacityDateRange
	err := scanAll(ctx, q, `SELECT start_date::text, end_date::text, capacity, is_active
		FROM ticketing.ticket_capacity_dates
		WHERE branch_id = $1 AND company_id = $2 AND is_active = true
		  AND start_date <= $4::date AND $3::date <= end_date`, []any{v.BranchID, v.CompanyID, from, to},
		func(scan func(...any) error) error {
			var r domain.CapacityDateRange
			err := scan(&r.StartDate, &r.EndDate, &r.Capacity, &r.IsActive)
			out = append(out, r)
			return err
		})
	return out, err
}

// countCapacityUsed is the live occupancy of one date: seat-holding
// booking guests plus walk-in bands of non-void visits opened that day
// (visits redeemed from a booking are already counted on the booking side).
func countCapacityUsed(ctx context.Context, q database.Querier, v Venue, date string) (int, error) {
	var online, walkIn int
	err := q.QueryRow(ctx, `SELECT
		  (SELECT COUNT(*) FROM ticketing.ticket_booking_guests g
		   JOIN ticketing.ticket_bookings b ON b.id = g.booking_id
		   WHERE b.branch_id = $1 AND b.company_id = $2
		     AND b.visit_date = $3::date AND b.status = ANY($4)),
		  (SELECT COUNT(*) FROM ticketing.ticket_visit_bands vb
		   JOIN ticketing.ticket_visits v ON v.id = vb.visit_id
		   WHERE v.branch_id = $1 AND v.company_id = $2
		     AND v.status <> 'void'
		     AND (v.opened_at AT TIME ZONE 'Asia/Jakarta')::date = $3::date
		     AND NOT EXISTS (SELECT 1 FROM ticketing.ticket_bookings bk WHERE bk.visit_id = v.id))`,
		v.BranchID, v.CompanyID, date, domain.CapacityHoldingStatuses).Scan(&online, &walkIn)
	return online + walkIn, err
}

// assertCapacityAvailable is assertCapacityAvailable: a cheap unlocked
// check first (unlimited = no lock), then lock, resolve again, count live.
func assertCapacityAvailable(ctx context.Context, q database.Querier, v Venue, date string, additional int) error {
	before, err := loadEffectiveCapacity(ctx, q, v, date)
	if err != nil || before == nil {
		return err
	}
	if err := acquireCapacityLock(ctx, q, v, date); err != nil {
		return err
	}
	capacity, err := loadEffectiveCapacity(ctx, q, v, date)
	if err != nil || capacity == nil {
		return err
	}
	used, err := countCapacityUsed(ctx, q, v, date)
	if err != nil {
		return err
	}
	if domain.IsCapacityExceeded(capacity, used, additional) {
		if *capacity == 0 {
			return httpx.Conflict("Tanggal ini ditutup untuk kunjungan — pilih tanggal lain")
		}
		return httpx.Conflict("Kuota tanggal ini sudah penuh — pilih tanggal lain")
	}
	return nil
}

// OccupancyDay is one row of the ops occupancy calendar.
type OccupancyDay struct {
	Date     string `json:"date"`
	Online   int    `json:"online"`
	WalkIn   int    `json:"walk_in"`
	Capacity *int   `json:"capacity"`
}

// Occupancy is buildOccupancy for [from..to].
func (s *Service) Occupancy(ctx context.Context, v Venue, from, to string) ([]OccupancyDay, error) {
	var venueDefault *int
	err := s.db.QueryRow(ctx, `SELECT daily_capacity FROM ticketing.ticket_settings
		WHERE branch_id = $1 AND company_id = $2`, v.BranchID, v.CompanyID).Scan(&venueDefault)
	if err != nil && !database.IsNoRows(err) {
		return nil, err
	}
	overrides, err := capacityOverrides(ctx, s.db, v, from, to)
	if err != nil {
		return nil, err
	}
	online, err := countByDay(ctx, s.db, `SELECT b.visit_date::text, COUNT(*)
		FROM ticketing.ticket_booking_guests g
		JOIN ticketing.ticket_bookings b ON b.id = g.booking_id
		WHERE b.branch_id = $1 AND b.company_id = $2
		  AND b.visit_date BETWEEN $3::date AND $4::date AND b.status = ANY($5)
		GROUP BY b.visit_date`, v.BranchID, v.CompanyID, from, to, domain.CapacityHoldingStatuses)
	if err != nil {
		return nil, err
	}
	walkIn, err := countByDay(ctx, s.db, `SELECT (v.opened_at AT TIME ZONE 'Asia/Jakarta')::date::text, COUNT(*)
		FROM ticketing.ticket_visit_bands vb
		JOIN ticketing.ticket_visits v ON v.id = vb.visit_id
		WHERE v.branch_id = $1 AND v.company_id = $2 AND v.status <> 'void'
		  AND (v.opened_at AT TIME ZONE 'Asia/Jakarta')::date BETWEEN $3::date AND $4::date
		  AND NOT EXISTS (SELECT 1 FROM ticketing.ticket_bookings bk WHERE bk.visit_id = v.id)
		GROUP BY 1`, v.BranchID, v.CompanyID, from, to)
	if err != nil {
		return nil, err
	}
	days := []OccupancyDay{}
	for _, date := range domain.EachDayISO(from, to) {
		capacity, _ := domain.ResolveDailyCapacity(date, venueDefault, overrides)
		days = append(days, OccupancyDay{Date: date, Online: online[date], WalkIn: walkIn[date], Capacity: capacity})
	}
	return days, nil
}

func countByDay(ctx context.Context, q database.Querier, sql string, args ...any) (map[string]int, error) {
	out := map[string]int{}
	err := scanAll(ctx, q, sql, args, func(scan func(...any) error) error {
		var day string
		var n int
		err := scan(&day, &n)
		out[day] = n
		return err
	})
	return out, err
}
