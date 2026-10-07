// Package domain holds the pure POS sales rules: cart pricing, discount
// stacks, central-checkout allocation, payment guards and the coercions the
// TS routes apply to their loosely typed JSON bodies. No database, no HTTP.
package domain

import (
	"encoding/json"
	"math"
	"strconv"
	"strings"
)

// Undefined marks a JSON key that was absent (JS undefined), as opposed to
// an explicit null (Go nil).
type Undefined struct{}

// Obj is a decoded JSON object (numbers as json.Number). Reads mirror JS
// property access: a missing key is Undefined.
type Obj map[string]any

// Get returns the value at key, or Undefined{} when the key is absent.
func (o Obj) Get(key string) any {
	if o == nil {
		return Undefined{}
	}
	v, ok := o[key]
	if !ok {
		return Undefined{}
	}
	return v
}

// Has reports whether the key is present (any value, null included).
func (o Obj) Has(key string) bool {
	_, ok := o[key]
	return ok
}

// Num is Number(o[key]) (NaN possible).
func (o Obj) Num(key string) float64 { return Number(o.Get(key)) }

// NumOr0 is `Number(o[key]) || 0`.
func (o Obj) NumOr0(key string) float64 { return Or0(Number(o.Get(key))) }

// Str is `String(o[key] || "")`.
func (o Obj) Str(key string) string { return StrOr(o.Get(key), "") }

// Truthy is Boolean(o[key]).
func (o Obj) Truthy(key string) bool { return Truthy(o.Get(key)) }

// IsNullish reports `o[key] == null` (undefined or null).
func (o Obj) IsNullish(key string) bool { return IsNullish(o.Get(key)) }

// Child returns o[key] as an object (nil when it is not one).
func (o Obj) Child(key string) Obj {
	m, _ := o.Get(key).(map[string]any)
	return m
}

// List returns o[key] as an array (nil, false when it is not one).
func (o Obj) List(key string) ([]any, bool) {
	l, ok := o.Get(key).([]any)
	return l, ok
}

// IsNullish is `v == null`.
func IsNullish(v any) bool {
	switch v.(type) {
	case nil, Undefined:
		return true
	}
	return false
}

// Truthy is Boolean(v) for JSON values.
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
	case int:
		return x != 0
	}
	return true // objects and arrays
}

// Number mirrors JS Number(v) for JSON values.
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
		if err != nil {
			return math.NaN()
		}
		return f
	case float64:
		return x
	case int:
		return float64(x)
	case string:
		return stringToNumber(x)
	case []any:
		switch len(x) {
		case 0:
			return 0
		case 1:
			if IsNullish(x[0]) {
				return 0
			}
			return stringToNumber(String(x[0]))
		}
		return math.NaN()
	}
	return math.NaN()
}

func stringToNumber(s string) float64 {
	s = Trim(s)
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
	for _, p := range []struct {
		prefix string
		base   int
	}{{"0x", 16}, {"0o", 8}, {"0b", 2}} {
		if strings.HasPrefix(lower, p.prefix) {
			digits := s[2:]
			if digits == "" {
				return math.NaN()
			}
			n := 0.0
			for _, c := range strings.ToLower(digits) {
				d := strings.IndexRune("0123456789abcdef", c)
				if d < 0 || d >= p.base {
					return math.NaN()
				}
				n = n*float64(p.base) + float64(d)
			}
			return n
		}
	}
	// strconv accepts forms JS rejects (underscores, "inf", hex floats).
	for _, r := range s {
		if !(r >= '0' && r <= '9' || r == '.' || r == 'e' || r == 'E' || r == '+' || r == '-') {
			return math.NaN()
		}
	}
	f, err := strconv.ParseFloat(s, 64)
	if err != nil && !math.IsInf(f, 0) { // overflow is ±Infinity in JS
		return math.NaN()
	}
	return f
}

// Or0 is `x || 0` for a number (NaN and 0 become 0).
func Or0(x float64) float64 {
	if math.IsNaN(x) {
		return 0
	}
	return x
}

// Or is `x || fallback` for a number.
func Or(x, fallback float64) float64 {
	if math.IsNaN(x) || x == 0 {
		return fallback
	}
	return x
}

// Finite is Number.isFinite.
func Finite(x float64) bool { return !math.IsNaN(x) && !math.IsInf(x, 0) }

// ToNumber is the TS helper `Number.isFinite(Number(v)) ? Number(v) : fallback`.
func ToNumber(v any, fallback float64) float64 {
	n := Number(v)
	if Finite(n) {
		return n
	}
	return fallback
}

// String mirrors JS String(v) for JSON values.
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
		return NumberString(Number(x))
	case float64:
		return NumberString(x)
	case int:
		return strconv.Itoa(x)
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

// StrOr is `String(v || fallback)`.
func StrOr(v any, fallback string) string {
	if !Truthy(v) {
		return fallback
	}
	return String(v)
}

// NumberString is Number.prototype.toString for the values money uses.
func NumberString(f float64) string {
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
	if abs >= 1e21 || abs < 1e-6 {
		s := strconv.FormatFloat(f, 'e', -1, 64)
		// Go writes e+21 / e-07; JS writes e+21 / e-7.
		if i := strings.IndexAny(s, "e"); i >= 0 {
			mant, exp := s[:i], s[i+1:]
			sign := exp[0]
			digits := strings.TrimLeft(exp[1:], "0")
			if digits == "" {
				digits = "0"
			}
			return mant + "e" + string(sign) + digits
		}
		return s
	}
	return strconv.FormatFloat(f, 'f', -1, 64)
}

// Trim is String.prototype.trim.
func Trim(s string) string {
	return strings.TrimFunc(s, func(r rune) bool {
		switch r {
		case ' ', '\t', '\n', '\v', '\f', '\r', '\u00a0', '\u1680', '\u2028', '\u2029', '\u202f', '\u205f', '\u3000', '\ufeff':
			return true
		}
		return r >= ' ' && r <= ' '
	})
}

// RoundHalfUp is Math.round (ties toward +Infinity).
func RoundHalfUp(x float64) float64 {
	if math.IsNaN(x) || math.IsInf(x, 0) {
		return x
	}
	r := math.Floor(x)
	if x-r >= 0.5 {
		r++
	}
	if r == 0 && math.Signbit(x) {
		return math.Copysign(0, -1)
	}
	return r
}
