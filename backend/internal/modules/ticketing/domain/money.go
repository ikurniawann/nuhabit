// Package domain holds the pure ticketing rules: the two-way tab ledger,
// price resolution, bundle allocation, daily capacity, booking windows and
// the report aggregation. Port of frontend/src/lib/ticketing/{tab,pricing,
// bundle,capacity,booking,calendar,distribution,reports}.ts. No DB, no HTTP.
package domain

import (
	"math"
	"strconv"
	"strings"
)

// Round2 is Math.round(n * 100) / 100, with -0 folded to 0 the way
// JSON.stringify prints it.
func Round2(n float64) float64 {
	r := jsRound(n*100) / 100
	if r == 0 {
		return 0
	}
	return r
}

// jsRound is Math.round: halves round toward +Infinity.
func jsRound(x float64) float64 {
	if math.IsNaN(x) || math.IsInf(x, 0) {
		return x
	}
	return math.Floor(x + 0.5)
}

// JSNumber is Number(s) for the numeric strings node-postgres returns and
// the query-string values the routes read: trimmed, "" is 0, junk is NaN.
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
	lower := strings.ToLower(s)
	for prefix, base := range map[string]int{"0x": 16, "0o": 8, "0b": 2} {
		if strings.HasPrefix(lower, prefix) {
			n, err := strconv.ParseUint(s[2:], base, 64)
			if err != nil {
				return math.NaN()
			}
			return float64(n)
		}
	}
	if strings.ContainsAny(lower, "_inx") {
		return math.NaN()
	}
	f, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return math.NaN()
	}
	return f
}

// FormatNumber is String(n) for a JS number.
func FormatNumber(n float64) string {
	if n == 0 {
		return "0"
	}
	abs := math.Abs(n)
	if abs >= 1e21 || abs < 1e-6 {
		s := strconv.FormatFloat(n, 'e', -1, 64)
		// JS writes 1e+21 where Go writes 1e+21 too, but Go pads "e-07".
		mant, exp, _ := strings.Cut(s, "e")
		sign := exp[0]
		digits := strings.TrimLeft(exp[1:], "0")
		return mant + "e" + string(sign) + digits
	}
	return strconv.FormatFloat(n, 'f', -1, 64)
}

// FormatRupiah is formatRupiah: "Rp1.250.000", "-Rp5.000", rounded to rupiah.
func FormatRupiah(value float64) string {
	n := jsRound(value)
	sign := ""
	if n < 0 {
		sign = "-"
	}
	return sign + "Rp" + groupThousands(strconv.FormatFloat(math.Abs(n), 'f', 0, 64))
}

// groupThousands inserts the id-ID thousands separator (".").
func groupThousands(digits string) string {
	if len(digits) <= 3 {
		return digits
	}
	var b strings.Builder
	head := len(digits) % 3
	if head > 0 {
		b.WriteString(digits[:head])
	}
	for i := head; i < len(digits); i += 3 {
		if b.Len() > 0 {
			b.WriteByte('.')
		}
		b.WriteString(digits[i : i+3])
	}
	return b.String()
}
