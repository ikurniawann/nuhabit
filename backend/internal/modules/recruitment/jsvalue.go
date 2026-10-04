package recruitment

import (
	"math"
	"strings"

	"nuhabit/backend/internal/modules/recruitment/domain"
	"nuhabit/backend/internal/platform/jsmath"
	"nuhabit/backend/internal/platform/validate"
)

// JavaScript conversions of values decoded from an AI's JSON answer, which
// the TS normalizes with String(), Number() and Boolean().

// jsString is String(v).
func jsString(v any) string {
	switch x := v.(type) {
	case string:
		return x
	case float64:
		return validate.JSNumber(x)
	case bool:
		if x {
			return "true"
		}
		return "false"
	case nil:
		return "null"
	case []any:
		parts := make([]string, len(x))
		for i, e := range x {
			if e != nil {
				parts[i] = jsString(e)
			}
		}
		return strings.Join(parts, ",")
	}
	return "[object Object]"
}

// jsNumber is Number(v); nil is null (0).
func jsNumber(v any) float64 {
	switch x := v.(type) {
	case float64:
		return x
	case string:
		return domain.JSNumber(x)
	case bool:
		if x {
			return 1
		}
		return 0
	case nil:
		return 0
	case []any:
		return domain.JSNumber(jsString(x))
	}
	return math.NaN()
}

// jsTruthy is Boolean(v).
func jsTruthy(v any) bool {
	switch x := v.(type) {
	case nil:
		return false
	case bool:
		return x
	case float64:
		return x != 0 && !math.IsNaN(x)
	case string:
		return x != ""
	}
	return true
}

// field is obj?.[key] for a decoded value: nil unless obj is an object.
func field(obj any, key string) any {
	m, _ := obj.(map[string]any)
	return m[key]
}

// strOr is String(v ?? fallback).
func strOr(v any, fallback string) string {
	if v == nil {
		return fallback
	}
	return jsString(v)
}

// arrayOf is Array.isArray(v) ? v : [].
func arrayOf(v any) []any {
	a, _ := v.([]any)
	return a
}

// clampScore is Math.min(100, Math.max(0, Math.round(n))); NaN stays NaN
// and serializes as null, like JSON.stringify.
func clampScore(n float64) any {
	if math.IsNaN(n) {
		return nil
	}
	return math.Min(100, math.Max(0, jsmath.Round(n)))
}
