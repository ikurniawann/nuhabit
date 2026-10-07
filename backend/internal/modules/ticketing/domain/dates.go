package domain

import (
	"regexp"
	"strconv"
	"time"
)

// Calendar dates are "YYYY-MM-DD" strings compared lexically, as in
// calendar.ts and pricing.ts. Venue time is Asia/Jakarta.

var jakarta = mustJakarta()

func mustJakarta() *time.Location {
	loc, err := time.LoadLocation("Asia/Jakarta")
	if err != nil {
		return time.FixedZone("WIB", 7*3600)
	}
	return loc
}

var isoDatePattern = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)

// IsValidCalendarDate is isValidCalendarDate: YYYY-MM-DD and a real date.
func IsValidCalendarDate(value string) bool {
	if !isoDatePattern.MatchString(value) {
		return false
	}
	_, err := time.Parse("2006-01-02", value)
	return err == nil
}

func parseISO(iso string) time.Time {
	y, _ := strconv.Atoi(iso[0:4])
	m, _ := strconv.Atoi(iso[5:7])
	d, _ := strconv.Atoi(iso[8:10])
	return time.Date(y, time.Month(m), d, 0, 0, 0, 0, time.UTC)
}

// AddDaysISO is addDaysIso.
func AddDaysISO(iso string, days int) string {
	return parseISO(iso).AddDate(0, 0, days).Format("2006-01-02")
}

// AddMonthsISO is addMonthsIso: UTC month arithmetic, Jan 31 + 1 month
// overflows into March like Date.setUTCMonth.
func AddMonthsISO(iso string, months int) string {
	t := parseISO(iso)
	return time.Date(t.Year(), t.Month()+time.Month(months), t.Day(), 0, 0, 0, 0, time.UTC).Format("2006-01-02")
}

// DaysBetweenISO is daysBetweenIso.
func DaysBetweenISO(from, to string) int {
	return int(parseISO(to).Sub(parseISO(from)).Hours() / 24)
}

// DateRangeError is dateRangeError ("" when the range is valid).
func DateRangeError(from, to string, maxDays int) string {
	if !IsValidCalendarDate(from) || !IsValidCalendarDate(to) || to < from {
		return "Rentang tanggal tidak valid"
	}
	if DaysBetweenISO(from, to) > maxDays {
		return "Rentang maksimum " + strconv.Itoa(maxDays) + " hari"
	}
	return ""
}

// EachDayISO lists every date in [from..to].
func EachDayISO(from, to string) []string {
	days := []string{}
	for d := from; d <= to; d = AddDaysISO(d, 1) {
		days = append(days, d)
	}
	return days
}

// TodayJakarta is todayInJakarta.
func TodayJakarta(now time.Time) string { return now.In(jakarta).Format("2006-01-02") }

// NowJakartaTime is nowJakartaTime: "HH:MM" in WIB.
func NowJakartaTime(now time.Time) string { return now.In(jakarta).Format("15:04") }

var (
	monthsShort = [...]string{"Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"}
	monthsLong  = [...]string{"Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"}
	weekdays    = [...]string{"Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"}
)

// FormatDate is formatDate for a calendar date: "4 Okt 2026" ("-" when
// the value is not a date).
func FormatDate(iso string) string {
	if !IsValidCalendarDate(iso) {
		return "-"
	}
	t := parseISO(iso)
	return strconv.Itoa(t.Day()) + " " + monthsShort[t.Month()-1] + " " + strconv.Itoa(t.Year())
}

// FormatDateLong is formatDateLong for a calendar date: "Minggu, 4 Oktober 2026".
func FormatDateLong(iso string) string {
	if !IsValidCalendarDate(iso) {
		return "-"
	}
	t := parseISO(iso)
	return weekdays[t.Weekday()] + ", " + strconv.Itoa(t.Day()) + " " + monthsLong[t.Month()-1] + " " + strconv.Itoa(t.Year())
}
