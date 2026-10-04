// Package domain holds the pure HRIS rules: calendar math in WIB, shift
// schedules and the attendance roster, leave day counting with public
// holidays, Indonesian employment contract law (PKWT/PKWTT), overtime and
// logbook authorization, report aggregation. No database, no HTTP.
package domain

import (
	"math"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode"
)

// WIBOffset is Asia/Jakarta (UTC+7, no DST): shift times and "today" are WIB.
const WIBOffset = 7 * time.Hour

// DateLayout is a plain calendar date ("YYYY-MM-DD").
const DateLayout = "2006-01-02"

// DateRe and UUIDRe mirror DATE_RE and UUID_RE in lib/hris/workforce-route.
var (
	DateRe = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)
	UUIDRe = regexp.MustCompile(`^(?i)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)
)

// IsUUID is isUuid from workforce-route (any version nibble).
func IsUUID(s string) bool { return UUIDRe.MatchString(s) }

// TodayWIB is todayWib: the WIB calendar date of now.
func TodayWIB(now time.Time) string { return now.UTC().Add(WIBOffset).Format(DateLayout) }

// NowWIB shifts now by +7h so its UTC fields read as WIB wall time.
func NowWIB(now time.Time) time.Time { return now.UTC().Add(WIBOffset) }

// ParseDate reads "YYYY-MM-DD" as UTC midnight.
func ParseDate(s string) (time.Time, bool) {
	if !DateRe.MatchString(s) {
		return time.Time{}, false
	}
	t, err := time.Parse(DateLayout, s)
	return t, err == nil
}

// IsoDayOfWeek is 1 = Monday … 7 = Sunday for a calendar date.
func IsoDayOfWeek(dateISO string) int {
	t, _ := time.Parse(DateLayout, dateISO)
	if d := int(t.Weekday()); d != 0 {
		return d
	}
	return 7
}

// AddDaysISO is addDaysIso.
func AddDaysISO(dateISO string, days int) string {
	t, _ := time.Parse(DateLayout, dateISO)
	return t.AddDate(0, 0, days).Format(DateLayout)
}

// EachDateISO lists the dates of [start, end] inclusive; empty when end < start.
func EachDateISO(startISO, endISO string) []string {
	start, ok1 := ParseDate(startISO)
	end, ok2 := ParseDate(endISO)
	out := []string{}
	if !ok1 || !ok2 {
		return out
	}
	for d := start; !d.After(end); d = d.AddDate(0, 0, 1) {
		out = append(out, d.Format(DateLayout))
	}
	return out
}

// JSTrim is String.prototype.trim: Unicode whitespace plus the BOM.
func JSTrim(s string) string {
	return strings.TrimFunc(s, func(r rune) bool { return unicode.IsSpace(r) || r == '\uFEFF' })
}

// JSNumber is Number(s) for a string: whitespace-trimmed, "" is 0, hex,
// binary and octal prefixes, Infinity; anything else NaN.
func JSNumber(s string) float64 {
	t := JSTrim(s)
	if t == "" {
		return 0
	}
	switch t {
	case "Infinity", "+Infinity":
		return math.Inf(1)
	case "-Infinity":
		return math.Inf(-1)
	}
	if len(t) > 2 && t[0] == '0' {
		base := 0
		switch t[1] {
		case 'x', 'X':
			base = 16
		case 'b', 'B':
			base = 2
		case 'o', 'O':
			base = 8
		}
		if base != 0 {
			n, err := strconv.ParseUint(t[2:], base, 64)
			if err != nil {
				return math.NaN()
			}
			return float64(n)
		}
	}
	for _, r := range t {
		if !strings.ContainsRune("0123456789+-.eE", r) {
			return math.NaN()
		}
	}
	f, err := strconv.ParseFloat(t, 64)
	if err != nil {
		if ne, ok := err.(*strconv.NumError); ok && ne.Err == strconv.ErrRange {
			return f
		}
		return math.NaN()
	}
	return f
}

// IsFinite is Number.isFinite.
func IsFinite(f float64) bool { return !math.IsNaN(f) && !math.IsInf(f, 0) }

// ParseIntJS is parseInt(s) (radix 10): leading whitespace, optional sign,
// the longest digit prefix; ok=false is NaN.
func ParseIntJS(s string) (int, bool) {
	t := strings.TrimLeftFunc(s, unicode.IsSpace)
	sign := 1
	if t != "" && (t[0] == '+' || t[0] == '-') {
		if t[0] == '-' {
			sign = -1
		}
		t = t[1:]
	}
	end := 0
	for end < len(t) && t[end] >= '0' && t[end] <= '9' {
		end++
	}
	if end == 0 {
		return 0, false
	}
	n, err := strconv.Atoi(t[:end])
	if err != nil {
		return 0, false
	}
	return sign * n, true
}

// IntOr is `parseInt(s || def) || def`: 0 and NaN fall back to def.
func IntOr(s string, def int) int {
	if s == "" {
		return def
	}
	n, ok := ParseIntJS(s)
	if !ok || n == 0 {
		return def
	}
	return n
}

// Clamp bounds n to [lo, hi].
func Clamp(n, lo, hi int) int { return min(max(n, lo), hi) }

// Round2 is Math.round(x * 100) / 100.
func Round2(x float64) float64 { return JSRound(x*100) / 100 }

// JSRound is Math.round: halves round toward +Infinity.
func JSRound(x float64) float64 { return math.Floor(x + 0.5) }

// ToFixed is Number(x.toFixed(digits)) for the magnitudes HR reports use.
func ToFixed(x float64, digits int) float64 {
	f, _ := strconv.ParseFloat(strconv.FormatFloat(x, 'f', digits, 64), 64)
	return f
}
