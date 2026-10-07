package ticketing

import (
	"context"

	"nuhabit/backend/internal/modules/ticketing/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
)

// The public side of capacity-server.ts: the availability calendar (full
// or closed dates only, never the numbers), timed-entry slots and the
// per-slot guard of the booking transaction. The slot guard takes the same
// (branch, date) advisory lock as the daily guard.

// bookingSlot is BookingSlot.
type bookingSlot struct {
	ID        string
	Label     string
	StartTime string // HH:MM:SS
	EndTime   string
	Capacity  *int
}

const bookingSlotColumns = `id::text, label, start_time::text, end_time::text, capacity`

func scanSlot(scan func(...any) error) (bookingSlot, error) {
	var s bookingSlot
	err := scan(&s.ID, &s.Label, &s.StartTime, &s.EndTime, &s.Capacity)
	return s, err
}

// loadActiveSlots is loadActiveSlots.
func loadActiveSlots(ctx context.Context, q database.Querier, v Venue) ([]bookingSlot, error) {
	var out []bookingSlot
	err := scanAll(ctx, q, `SELECT `+bookingSlotColumns+` FROM ticketing.ticket_time_slots
		WHERE branch_id = $1 AND company_id = $2 AND is_active = true
		ORDER BY sort_order, start_time`, []any{v.BranchID, v.CompanyID}, func(scan func(...any) error) error {
		s, err := scanSlot(scan)
		out = append(out, s)
		return err
	})
	return out, err
}

// loadActiveSlot is loadActiveSlot inside the booking transaction.
func loadActiveSlot(ctx context.Context, q database.Querier, v Venue, slotID string) (*bookingSlot, error) {
	s, err := scanSlot(q.QueryRow(ctx, `SELECT `+bookingSlotColumns+` FROM ticketing.ticket_time_slots
		WHERE id = $1 AND branch_id = $2 AND company_id = $3 AND is_active = true`, slotID, v.BranchID, v.CompanyID).Scan)
	if database.IsNoRows(err) {
		return nil, nil
	}
	return &s, err
}

// countSlotUsedByDate is countSlotUsedByDate: people per slot on date.
func countSlotUsedByDate(ctx context.Context, q database.Querier, v Venue, date string) (map[string]int, error) {
	return countByDay(ctx, q, `SELECT b.slot_id::text, COUNT(*)
		FROM ticketing.ticket_booking_guests g
		JOIN ticketing.ticket_bookings b ON b.id = g.booking_id
		WHERE b.branch_id = $1 AND b.company_id = $2
		  AND b.visit_date = $3::date AND b.slot_id IS NOT NULL
		  AND b.status = ANY($4)
		GROUP BY b.slot_id`, v.BranchID, v.CompanyID, date, domain.CapacityHoldingStatuses)
}

// assertSlotCapacity is assertSlotCapacity: no-op for an unlimited slot,
// else lock (venue, date), count live and 409 when full.
func assertSlotCapacity(ctx context.Context, q database.Querier, v Venue, date string, slot *bookingSlot, additional int) error {
	if slot.Capacity == nil {
		return nil
	}
	if err := acquireCapacityLock(ctx, q, v, date); err != nil {
		return err
	}
	var used int
	if err := q.QueryRow(ctx, `SELECT COUNT(*)
		FROM ticketing.ticket_booking_guests g
		JOIN ticketing.ticket_bookings b ON b.id = g.booking_id
		WHERE b.branch_id = $1 AND b.company_id = $2
		  AND b.visit_date = $3::date AND b.slot_id = $4
		  AND b.status = ANY($5)`, v.BranchID, v.CompanyID, date, slot.ID, domain.CapacityHoldingStatuses).Scan(&used); err != nil {
		return err
	}
	if domain.IsCapacityExceeded(slot.Capacity, used, additional) {
		return httpx.Conflict("Slot " + slot.Label + " pada tanggal ini sudah penuh — pilih slot lain")
	}
	return nil
}

// availability is buildAvailability: only the unavailable dates of
// [from..to], "closed" (capacity 0) or "sold_out". Read-only and without a
// lock: indicative, the booking guard decides.
func (s *Service) availability(ctx context.Context, v Venue, from, to string) (map[string]string, error) {
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
	out := map[string]string{}
	if venueDefault == nil && len(overrides) == 0 {
		return out, nil
	}
	days, err := s.Occupancy(ctx, v, from, to)
	if err != nil {
		return nil, err
	}
	for _, d := range days {
		switch {
		case d.Capacity == nil:
		case *d.Capacity == 0:
			out[d.Date] = "closed"
		case d.Online+d.WalkIn >= *d.Capacity:
			out[d.Date] = "sold_out"
		}
	}
	return out, nil
}
