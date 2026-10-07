// Package domain holds the pure rules of the integrations context: webhook
// authentication and payload parsing (Xendit, Telegram, loyalty partners,
// the WhatsApp gateway), the owner-notification settings and the masking of
// stored secrets. No database, no HTTP.
package domain

import (
	"bytes"
	"encoding/json"
	"io"
	"math"
	"strconv"
	"strings"

	"nuhabit/backend/internal/platform/validate"
)

// Helpers for JavaScript's coercions on decoded JSON (json.Number numbers).

// Truthy is JS truthiness on a decoded JSON value.
func Truthy(v any) bool {
	switch x := v.(type) {
	case nil:
		return false
	case bool:
		return x
	case string:
		return x != ""
	case json.Number:
		f, err := x.Float64()
		return err == nil && f != 0 && !math.IsNaN(f)
	case float64:
		return x != 0 && !math.IsNaN(x)
	}
	return true
}

// or is `a || b || …`: the first truthy value, else the last one.
func or(values ...any) any {
	for _, v := range values {
		if Truthy(v) {
			return v
		}
	}
	return values[len(values)-1]
}

// jsString is String(v) for a decoded JSON value.
func jsString(v any) string {
	switch x := v.(type) {
	case nil:
		return "null"
	case string:
		return x
	case bool:
		return strconv.FormatBool(x)
	case json.Number:
		f, err := x.Float64()
		if err != nil {
			return x.String()
		}
		return validate.JSNumber(f)
	case float64:
		return validate.JSNumber(x)
	case []any:
		parts := make([]string, len(x))
		for i, item := range x {
			if item != nil {
				parts[i] = jsString(item)
			}
		}
		return strings.Join(parts, ",")
	}
	return "[object Object]"
}

// jsNumber is Number(v): NaN when it does not convert.
func jsNumber(v any) float64 {
	switch x := v.(type) {
	case nil:
		return 0
	case bool:
		if x {
			return 1
		}
		return 0
	case json.Number:
		f, err := x.Float64()
		if err != nil {
			return math.NaN()
		}
		return f
	case float64:
		return x
	case string:
		return StringNumber(x)
	case []any:
		switch len(x) {
		case 0:
			return 0
		case 1:
			return jsNumber(jsString(x[0]))
		}
	}
	return math.NaN()
}

// StringNumber is Number(s) for a string: trimmed decimal or 0x/0o/0b
// integer, "" is 0, anything else NaN.
func StringNumber(s string) float64 {
	t := validate.JSTrim(s)
	if t == "" {
		return 0
	}
	if len(t) > 2 && t[0] == '0' {
		base := map[byte]int{'x': 16, 'X': 16, 'o': 8, 'O': 8, 'b': 2, 'B': 2}[t[1]]
		if base != 0 {
			n, err := strconv.ParseUint(t[2:], base, 64)
			if err != nil {
				return math.NaN()
			}
			return float64(n)
		}
	}
	switch t {
	case "Infinity", "+Infinity":
		return math.Inf(1)
	case "-Infinity":
		return math.Inf(-1)
	}
	for _, c := range t {
		if !(c >= '0' && c <= '9' || c == '.' || c == 'e' || c == 'E' || c == '+' || c == '-') {
			return math.NaN()
		}
	}
	f, err := strconv.ParseFloat(t, 64)
	if err != nil {
		return math.NaN()
	}
	return f
}

// finite reports a number that is neither NaN nor infinite.
func finite(f float64) bool { return !math.IsNaN(f) && !math.IsInf(f, 0) }

// ParseJSON is JSON.parse with numbers kept as json.Number; ok=false when
// raw is not exactly one JSON value.
func ParseJSON(raw []byte) (any, bool) {
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	var v any
	if dec.Decode(&v) != nil {
		return nil, false
	}
	if _, err := dec.Token(); err != io.EOF {
		return nil, false
	}
	return v, true
}

// Obj is v as an object, nil otherwise.
func Obj(v any) map[string]any {
	m, _ := v.(map[string]any)
	return m
}
