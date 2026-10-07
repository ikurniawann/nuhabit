package domain

import (
	"strconv"
	"strings"
)

// Daily venue capacity (capacity.ts): counted per person, default in
// ticket_settings.daily_capacity (nil = unlimited), overridden per date
// range in ticket_capacity_dates.

// CapacityHoldingStatuses are the booking statuses that hold a seat.
var CapacityHoldingStatuses = []string{"menunggu-bayar", "terbayar", "digunakan"}

// CapacityDateRange is one ticket_capacity_dates row.
type CapacityDateRange struct {
	StartDate string
	EndDate   string
	Capacity  int
	IsActive  bool
}

// ResolveDailyCapacity is resolveDailyCapacity: active overrides win over
// the venue default and the smallest overlapping override wins. nil means
// unlimited. ok=false for an invalid date (the TS throws).
func ResolveDailyCapacity(date string, venueDefault *int, overrides []CapacityDateRange) (*int, bool) {
	if !IsValidCalendarDate(date) {
		return nil, false
	}
	var min *int
	for _, r := range overrides {
		if r.IsActive && r.StartDate <= date && date <= r.EndDate && (min == nil || r.Capacity < *min) {
			c := r.Capacity
			min = &c
		}
	}
	if min == nil {
		return venueDefault, true
	}
	return min, true
}

// IsCapacityExceeded is isCapacityExceeded; unlimited never overflows.
func IsCapacityExceeded(capacity *int, used, additional int) bool {
	return capacity != nil && used+additional > *capacity
}

// Slot window outcomes.
const (
	SlotOK       = "ok"
	SlotTooEarly = "terlalu-awal"
	SlotTooLate  = "terlambat"
)

func minutesOfDay(clock string) int {
	parts := strings.Split(clock, ":")
	h, _ := strconv.Atoi(parts[0])
	m := 0
	if len(parts) > 1 {
		m, _ = strconv.Atoi(parts[1])
	}
	return h*60 + m
}

// SlotWindowStatus is slotWindowStatus: entry allowed from start-grace to
// end+grace, both inclusive.
func SlotWindowStatus(now, slotStart, slotEnd string, graceMinutes int) string {
	n := minutesOfDay(now)
	if n < minutesOfDay(slotStart)-graceMinutes {
		return SlotTooEarly
	}
	if n > minutesOfDay(slotEnd)+graceMinutes {
		return SlotTooLate
	}
	return SlotOK
}
