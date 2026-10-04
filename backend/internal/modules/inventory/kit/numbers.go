package kit

import (
	"crypto/rand"
	"database/sql/driver"
	"encoding/hex"
	"math"
	"strconv"
	"strings"
	"time"

	"nuhabit/backend/internal/modules/inventory/domain"
)

// ToNum is Number(value) with NaN and non-finite values as 0 (toNumber,
// toQty in the TS libs). Strings are trimmed like Number(" 1 ").
func ToNum(v any) float64 {
	var f float64
	switch x := v.(type) {
	case nil:
		return 0
	case float64:
		f = x
	case float32:
		f = float64(x)
	case int:
		f = float64(x)
	case int32:
		f = float64(x)
	case int16:
		f = float64(x)
	case int64:
		f = float64(x)
	case bool:
		if x {
			return 1
		}
		return 0
	case string:
		f = JSNumber(x)
	default:
		return 0
	}
	if math.IsNaN(f) || math.IsInf(f, 0) {
		return 0
	}
	return f
}

// JSNumber is Number(s) for a string: "" and whitespace are 0, anything not
// a decimal (or 0x/0b/0o, Infinity) literal is NaN.
func JSNumber(s string) float64 {
	s = strings.TrimSpace(s)
	if s == "" {
		return 0
	}
	switch s {
	case "Infinity", "+Infinity":
		return math.Inf(1)
	case "-Infinity":
		return math.Inf(-1)
	}
	if len(s) > 2 && s[0] == '0' {
		base := 0
		switch s[1] {
		case 'x', 'X':
			base = 16
		case 'b', 'B':
			base = 2
		case 'o', 'O':
			base = 8
		}
		if base != 0 {
			n, err := strconv.ParseUint(s[2:], base, 64)
			if err != nil {
				return math.NaN()
			}
			return float64(n)
		}
	}
	for _, c := range s {
		if !(c >= '0' && c <= '9' || c == '.' || c == 'e' || c == 'E' || c == '+' || c == '-') {
			return math.NaN()
		}
	}
	f, err := strconv.ParseFloat(s, 64)
	if err != nil {
		if ne, ok := err.(*strconv.NumError); ok && ne.Err == strconv.ErrRange {
			return f
		}
		return math.NaN()
	}
	return f
}

// ParseInt is parseInt(s, 10): leading whitespace and sign, then digits up
// to the first non-digit; ok is false for NaN.
func ParseInt(s string) (int, bool) {
	s = strings.TrimLeft(s, " \t\n\r\v\f")
	neg := false
	if s != "" && (s[0] == '+' || s[0] == '-') {
		neg = s[0] == '-'
		s = s[1:]
	}
	end := 0
	for end < len(s) && s[end] >= '0' && s[end] <= '9' {
		end++
	}
	if end == 0 {
		return 0, false
	}
	n, err := strconv.Atoi(s[:end])
	if err != nil {
		return 0, false
	}
	if neg {
		n = -n
	}
	return n, true
}

// JSNum formats a number like String(n) in JS. Use it to send numbers to
// numeric columns exactly as node-postgres does, and in messages.
func JSNum(f float64) string { return domain.JSNum(f) }

// Num is a float64 parameter that reaches PostgreSQL as text String(n),
// the way node-postgres serializes a JS number: NaN or 2.5 sent to an
// integer column fail with 22P02 exactly as they do from TS. It is a struct
// so pgx cannot unwrap it into a binary float.
type Num struct{ f float64 }

// N wraps a float64 parameter.
func N(f float64) Num { return Num{f} }

// Value implements driver.Valuer.
func (n Num) Value() (driver.Value, error) { return JSNum(n.f), nil }

// RoundQty is Math.round(v * 1000) / 1000.
func RoundQty(v float64) float64 { return JSRound(v*1000) / 1000 }

// Round2 is Math.round(v * 100) / 100.
func Round2(v float64) float64 { return JSRound(v*100) / 100 }

// JSRound is Math.round: halves round toward +Infinity.
func JSRound(v float64) float64 { return math.Floor(v + 0.5) }

// NewUUID is crypto.randomUUID().
func NewUUID() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	b[6] = b[6]&0x0f | 0x40
	b[8] = b[8]&0x3f | 0x80
	h := hex.EncodeToString(b[:])
	return h[0:8] + "-" + h[8:12] + "-" + h[12:16] + "-" + h[16:20] + "-" + h[20:32]
}

var jakarta = func() *time.Location {
	if loc, err := time.LoadLocation("Asia/Jakarta"); err == nil {
		return loc
	}
	return time.FixedZone("WIB", 7*3600)
}()

// Jakarta is the Asia/Jakarta location.
func Jakarta() *time.Location { return jakarta }

// TodayJakarta is todayJakarta(): YYYY-MM-DD in Asia/Jakarta.
func TodayJakarta(now time.Time) string { return now.In(jakarta).Format("2006-01-02") }

// UTCDate is new Date().toISOString().slice(0, 10).
func UTCDate(now time.Time) string { return now.UTC().Format("2006-01-02") }

// AddDays is addDays(date, days) on a YYYY-MM-DD string.
func AddDays(date string, days int) string {
	t, err := time.Parse("2006-01-02", date[:min(len(date), 10)])
	if err != nil {
		return date
	}
	return t.AddDate(0, 0, days).Format("2006-01-02")
}

// Ptr returns &v.
func Ptr[T any](v T) *T { return &v }

// OrNil returns nil for "" (the `value || null` idiom).
func OrNil(s *string) *string {
	if s == nil || *s == "" {
		return nil
	}
	return s
}

// SliceBounds clamps Array.prototype.slice(start, end) bounds.
func SliceBounds(n int, start, end float64) (int, int) {
	clamp := func(v float64) int {
		if math.IsNaN(v) {
			return 0
		}
		if v < 0 {
			v = math.Max(0, float64(n)+math.Trunc(v))
		}
		return int(math.Min(math.Trunc(v), float64(n)))
	}
	s, e := clamp(start), clamp(end)
	return s, max(s, e)
}

// FirstNonEmpty is a || b || ... over strings.
func FirstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if v != "" {
			return v
		}
	}
	return ""
}
