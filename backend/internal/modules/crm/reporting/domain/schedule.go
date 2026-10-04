package domain

import (
	"strconv"
	"strings"
	"time"
)

// Schedule enums in schema order.
var (
	ScheduleFrequencies = []string{"daily", "weekly", "monthly"}
	ScheduleChannels    = []string{"wa", "in_app"}
)

// SchedulePattern is the timing part of a report schedule.
type SchedulePattern struct {
	Frequency  string
	Hour       int
	DayOfWeek  *int
	DayOfMonth *int
}

// wibInstant is the instant of a WIB calendar date and hour (days overflow
// like Date.UTC).
func wibInstant(y int, m time.Month, d, hour int) time.Time {
	return time.Date(y, m, d, hour, 0, 0, 0, wib)
}

// ComputeNextRun mirrors computeNextRun: the next run strictly after from,
// at the schedule's WIB hour.
func ComputeNextRun(s SchedulePattern, from time.Time) time.Time {
	p := from.In(wib)
	y, m, d := p.Date()
	hour := min(23, max(0, s.Hour))

	switch s.Frequency {
	case "daily":
		run := wibInstant(y, m, d, hour)
		if run.After(from) {
			return run
		}
		return run.Add(24 * time.Hour)
	case "weekly":
		target := 1
		if s.DayOfWeek != nil {
			target = (*s.DayOfWeek%7 + 7) % 7
		}
		delta := (target - int(p.Weekday()) + 7) % 7
		run := wibInstant(y, m, d+delta, hour)
		if !run.After(from) {
			run = wibInstant(y, m, d+delta+7, hour)
		}
		return run
	}
	dom := 1
	if s.DayOfMonth != nil {
		dom = min(28, max(1, *s.DayOfMonth))
	}
	run := wibInstant(y, m, dom, hour)
	if !run.After(from) {
		run = wibInstant(y, m+1, dom, hour)
	}
	return run
}

// BuildScheduleMessage mirrors buildScheduleMessage (the WhatsApp text).
func BuildScheduleMessage(reportName, summary string, rowCount int, periodLabel, url string) string {
	lines := []string{"*" + reportName + "*", "Periode: " + periodLabel + " · " + strconv.Itoa(rowCount) + " baris", "", summary}
	if url != "" {
		lines = append(lines, "", "Buka: "+url)
	}
	return strings.Join(lines, "\n")
}

// NormalizePhone mirrors normalizePhone in lib/sales-funnel/server.ts:
// digits only, a leading 0 or 8 becomes 62.
func NormalizePhone(raw string) string {
	var b strings.Builder
	for _, r := range raw {
		if r >= '0' && r <= '9' {
			b.WriteRune(r)
		}
	}
	digits := b.String()
	switch {
	case strings.HasPrefix(digits, "0"):
		return "62" + digits[1:]
	case strings.HasPrefix(digits, "8"):
		return "62" + digits
	}
	return digits
}

// IsValidNormalizedPhone mirrors isValidNormalizedPhone.
func IsValidNormalizedPhone(phone string) bool {
	return len(phone) >= 10 && strings.HasPrefix(phone, "62")
}
