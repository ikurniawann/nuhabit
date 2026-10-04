package domain

import (
	"encoding/json"
	"math"
	"strconv"
	"strings"
)

// The helpers below give decoded JSON bodies (numbers as json.Number) the
// JavaScript coercions the TS routes apply to `body.x`.

// JSString is String(v).
func JSString(v any) string {
	switch x := v.(type) {
	case nil:
		return "null"
	case string:
		return x
	case bool:
		return strconv.FormatBool(x)
	case json.Number:
		return formatJSNumber(JSValueNumber(x))
	case float64:
		return formatJSNumber(x)
	case []any:
		parts := make([]string, len(x))
		for i, e := range x {
			if e != nil {
				parts[i] = JSString(e)
			}
		}
		return strings.Join(parts, ",")
	}
	return "[object Object]"
}

// JSValueNumber is Number(v).
func JSValueNumber(v any) float64 {
	switch x := v.(type) {
	case nil:
		return 0
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
	case string:
		return JSNumber(x)
	case []any:
		return JSNumber(JSString(x))
	}
	return math.NaN()
}

// JSTruthy is Boolean(v).
func JSTruthy(v any) bool {
	switch x := v.(type) {
	case nil:
		return false
	case bool:
		return x
	case string:
		return x != ""
	case json.Number, float64:
		n := JSValueNumber(x)
		return n != 0 && !math.IsNaN(n)
	}
	return true
}

// formatJSNumber is Number#toString for the values a request carries.
func formatJSNumber(x float64) string {
	switch {
	case math.IsNaN(x):
		return "NaN"
	case math.IsInf(x, 1):
		return "Infinity"
	case math.IsInf(x, -1):
		return "-Infinity"
	}
	if abs := math.Abs(x); x == 0 || (abs >= 1e-6 && abs < 1e21) {
		return strconv.FormatFloat(x, 'f', -1, 64)
	}
	mant, exp, _ := strings.Cut(strconv.FormatFloat(x, 'e', -1, 64), "e")
	return mant + "e" + exp[:1] + strings.TrimLeft(exp[1:], "0")
}
