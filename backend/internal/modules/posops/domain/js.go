// Package domain holds the pure POS operations rules: shift totals, table
// board status, reservation and SKU matrix rules, report arithmetic. The TS
// routes coerce loosely typed JSON with Number(), String() and truthiness;
// the helpers in this file reproduce those coercions so request parsing
// stays identical.
package domain

import (
	"encoding/json"
	"math"
	"strconv"
	"strings"
	"unicode"

	"nuhabit/backend/internal/platform/jsmath"
)

// Undefined marks a missing JSON key (JS undefined), distinct from null.
type Undefined struct{}

// Undef is the undefined value.
var Undef = Undefined{}

// Field returns body[key], or Undef when the key is absent or body is not
// an object.
func Field(body any, key string) any {
	m, ok := body.(map[string]any)
	if !ok {
		return Undef
	}
	v, ok := m[key]
	if !ok {
		return Undef
	}
	return v
}

// IsUndef reports whether v is undefined.
func IsUndef(v any) bool {
	_, ok := v.(Undefined)
	return ok
}

// IsNullish is v == null in JS (null or undefined).
func IsNullish(v any) bool { return v == nil || IsUndef(v) }

// Truthy is JS truthiness.
func Truthy(v any) bool {
	switch x := v.(type) {
	case nil, Undefined:
		return false
	case bool:
		return x
	case string:
		return x != ""
	case json.Number:
		f := Number(x)
		return f != 0 && !math.IsNaN(f)
	case float64:
		return x != 0 && !math.IsNaN(x)
	case int, int16, int32, int64, float32:
		return Number(x) != 0
	}
	return true
}

// Number is JS Number(v).
func Number(v any) float64 {
	switch x := v.(type) {
	case nil:
		return 0
	case Undefined:
		return math.NaN()
	case bool:
		if x {
			return 1
		}
		return 0
	case json.Number:
		f, err := strconv.ParseFloat(string(x), 64)
		if err != nil && !math.IsInf(f, 0) {
			return math.NaN()
		}
		return f
	case float64:
		return x
	case int:
		return float64(x)
	case int16:
		return float64(x)
	case int32:
		return float64(x)
	case int64:
		return float64(x)
	case float32:
		return float64(x)
	case string:
		return stringToNumber(x)
	case []any:
		return stringToNumber(String(x))
	}
	return math.NaN()
}

// Finite is Number.isFinite.
func Finite(f float64) bool { return !math.IsNaN(f) && !math.IsInf(f, 0) }

// ToNumber is the TS toNumber helper: Number(v) when finite, else 0.
func ToNumber(v any) float64 {
	f := Number(v)
	if !Finite(f) {
		return 0
	}
	return f
}

func stringToNumber(s string) float64 {
	s = strings.TrimFunc(s, func(r rune) bool { return unicode.IsSpace(r) || r == '\uFEFF' })
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
			n, err := strconv.ParseUint(s[2:], base, 64)
			if err != nil {
				return math.NaN()
			}
			return float64(n)
		}
	}
	for _, r := range s {
		if !(r >= '0' && r <= '9') && r != '.' && r != 'e' && r != 'E' && r != '+' && r != '-' {
			return math.NaN()
		}
	}
	f, err := strconv.ParseFloat(s, 64)
	if err != nil && !math.IsInf(f, 0) {
		return math.NaN()
	}
	return f
}

// String is JS String(v).
func String(v any) string {
	switch x := v.(type) {
	case nil:
		return "null"
	case Undefined:
		return "undefined"
	case bool:
		if x {
			return "true"
		}
		return "false"
	case string:
		return x
	case json.Number:
		return FormatNumber(Number(x))
	case float64:
		return FormatNumber(x)
	case int, int16, int32, int64, float32:
		return FormatNumber(Number(x))
	case []any:
		parts := make([]string, len(x))
		for i, e := range x {
			if !IsNullish(e) {
				parts[i] = String(e)
			}
		}
		return strings.Join(parts, ",")
	}
	return "[object Object]"
}

// FormatNumber is Number.prototype.toString for a double.
func FormatNumber(f float64) string {
	switch {
	case math.IsNaN(f):
		return "NaN"
	case math.IsInf(f, 1):
		return "Infinity"
	case math.IsInf(f, -1):
		return "-Infinity"
	case f == 0:
		return "0"
	}
	abs := math.Abs(f)
	if abs >= 1e-6 && abs < 1e21 {
		return strconv.FormatFloat(f, 'f', -1, 64)
	}
	s := strconv.FormatFloat(f, 'e', -1, 64) // 1e+21, 1.5e-07
	mant, exp, _ := strings.Cut(s, "e")
	sign := exp[0]
	exp = strings.TrimLeft(exp[1:], "0")
	return mant + "e" + string(sign) + exp
}

// TrimJS is String.prototype.trim.
func TrimJS(s string) string {
	return strings.TrimFunc(s, func(r rune) bool { return unicode.IsSpace(r) || r == '\uFEFF' })
}

// Round is Math.round.
func Round(f float64) float64 { return jsmath.Round(f) }

// Round2 is Math.round(f * 100) / 100.
func Round2(f float64) float64 { return jsmath.RoundTo(f, 2) }

// ParseInt is parseInt(s) without a radix: leading whitespace, a sign, a
// 0x prefix for hex, then digits up to the first invalid one; NaN when no
// digit was read.
func ParseInt(s string) float64 {
	s = strings.TrimLeftFunc(s, func(r rune) bool { return unicode.IsSpace(r) || r == '\uFEFF' })
	neg := false
	if s != "" && (s[0] == '+' || s[0] == '-') {
		neg = s[0] == '-'
		s = s[1:]
	}
	base := 10.0
	if len(s) >= 2 && s[0] == '0' && (s[1] == 'x' || s[1] == 'X') {
		base, s = 16, s[2:]
	}
	n, read := 0.0, false
	for _, r := range s {
		d := -1
		switch {
		case r >= '0' && r <= '9':
			d = int(r - '0')
		case base == 16 && r >= 'a' && r <= 'f':
			d = int(r-'a') + 10
		case base == 16 && r >= 'A' && r <= 'F':
			d = int(r-'A') + 10
		}
		if d < 0 {
			break
		}
		n, read = n*base+float64(d), true
	}
	if !read {
		return math.NaN()
	}
	if neg {
		return -n
	}
	return n
}
