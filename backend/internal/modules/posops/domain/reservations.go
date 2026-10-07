package domain

import (
	"math"
	"regexp"
)

var hhmm = regexp.MustCompile(`^\d{1,2}:\d{2}$`)

// NormalizeTimeSlot mirrors normalizeTimeSlot: "HH:MM" gains ":00", other
// text passes through trimmed.
func NormalizeTimeSlot(v any) string {
	if IsNullish(v) {
		v = ""
	}
	raw := TrimJS(String(v))
	if hhmm.MatchString(raw) {
		return raw + ":00"
	}
	return raw
}

// MaxGuestCount and DefaultGuestCount bound normalizeGuestCount.
const (
	DefaultGuestCount = 1
	MaxGuestCount     = 500
)

// NormalizeGuestCount mirrors normalizeGuestCount for a pax_count column.
func NormalizeGuestCount(pax *int) int {
	if pax == nil {
		return DefaultGuestCount
	}
	n := int(math.Floor(float64(*pax)))
	if n < 1 {
		return DefaultGuestCount
	}
	return min(n, MaxGuestCount)
}

// SeatNotes is the open bill note of a seated reservation:
// "Reservation · <guest>[ · <time>]".
func SeatNotes(customerName, timeSlot *string) string {
	guest := ""
	if customerName != nil {
		guest = TrimJS(*customerName)
	}
	if guest == "" {
		guest = "Guest"
	}
	notes := "Reservation · " + guest
	if timeSlot != nil {
		if slot := TrimJS(*timeSlot); slot != "" {
			notes += " · " + slot
		}
	}
	return notes
}

// ReservationStampColumn is the timestamp a status change sets:
// seated_at, completed_at, or cancelled_at for no_show and cancelled.
func ReservationStampColumn(status any) string {
	switch status {
	case "seated":
		return "seated_at"
	case "completed":
		return "completed_at"
	case "no_show", "cancelled":
		return "cancelled_at"
	}
	return ""
}

// ReservationTableStatus is the table status a reservation status change
// writes: occupied when seated, available when it ends.
func ReservationTableStatus(status any) string {
	switch status {
	case "seated":
		return "occupied"
	case "completed", "no_show", "cancelled":
		return "available"
	}
	return ""
}
