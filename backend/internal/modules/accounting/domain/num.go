// Package domain holds the pure accounting rules: account codes, fiscal
// period sequencing, double-entry validation, the journal state machine,
// journal-mapping line building, AP/AR outstanding and aging, report
// balances and the amount bags operational modules post. It imports only the
// standard library.
//
// Ported from frontend/src/lib/accounting/** and the posting helpers in
// lib/pos, lib/purchasing and lib/inventory. Numbers follow JavaScript
// semantics where the TypeScript relied on them (Math.round, Number(),
// template-literal number formatting).
package domain

import (
	"math"
	"regexp"
	"strconv"
	"strings"
	"unicode"
)

// MathRound is Math.round: halves round towards +Infinity.
func MathRound(x float64) float64 {
	if math.IsNaN(x) || math.IsInf(x, 0) {
		return x
	}
	r := math.Floor(x)
	if x-r >= 0.5 {
		r++
	}
	return r
}

// Round2 is the TS round2: Math.round(n * 100) / 100. Negative zero becomes
// zero (JSON.stringify and template literals print -0 as "0"). The float64
// conversions stop the compiler fusing the multiply into the rounding
// subtraction (FMA), which JavaScript never does.
func Round2(n float64) float64 {
	r := MathRound(float64(n*100)) / 100
	if r == 0 {
		return 0
	}
	return r
}

// FormatNumber is String(n) for a JavaScript number, as template literals
// print it ("Debit ${round2(debit)}").
func FormatNumber(n float64) string {
	switch {
	case math.IsNaN(n):
		return "NaN"
	case math.IsInf(n, 1):
		return "Infinity"
	case math.IsInf(n, -1):
		return "-Infinity"
	case n == 0:
		return "0"
	}
	abs := math.Abs(n)
	if abs >= 1e-6 && abs < 1e21 {
		return strconv.FormatFloat(n, 'f', -1, 64)
	}
	s := strconv.FormatFloat(n, 'e', -1, 64) // 1e-07, 1.5e+21
	mant, exp, _ := strings.Cut(s, "e")
	sign := exp[:1]
	digits := strings.TrimLeft(exp[1:], "0")
	return mant + "e" + sign + digits
}

var jsDecimal = regexp.MustCompile(`^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$`)

// IsJSSpace is the whitespace String.prototype.trim and /\s/ remove.
func IsJSSpace(r rune) bool { return unicode.IsSpace(r) || r == 0xFEFF }

// ParseNumber is Number(s) for a string: trimmed, "" is 0, hex/octal/binary
// prefixes, Infinity, otherwise a decimal literal or NaN.
func ParseNumber(s string) float64 {
	s = strings.TrimFunc(s, IsJSSpace)
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
		case 'o', 'O':
			base = 8
		case 'b', 'B':
			base = 2
		}
		if base != 0 {
			if v, err := strconv.ParseUint(s[2:], base, 64); err == nil {
				return float64(v)
			}
			return math.NaN()
		}
	}
	if !jsDecimal.MatchString(s) {
		return math.NaN()
	}
	v, err := strconv.ParseFloat(s, 64)
	if err != nil {
		// Out of range parses to ±Inf with an error; Number() does the same.
		if ne, ok := err.(*strconv.NumError); ok && ne.Err == strconv.ErrRange {
			return v
		}
		return math.NaN()
	}
	return v
}

// ToNumber is Number(v) || 0 for a numeric string from node-pg.
func ToNumber(s string) float64 {
	v := ParseNumber(s)
	if math.IsNaN(v) {
		return 0
	}
	return v
}

// PageNumber mirrors Math.min(Math.max(n, lo), hi) (hi <= 0 means no upper
// bound) on a JavaScript number, NaN included.
func PageNumber(n, lo, hi float64) float64 {
	if math.IsNaN(n) {
		return n
	}
	n = math.Max(n, lo)
	if hi > 0 {
		n = math.Min(n, hi)
	}
	return n
}
