package kitchen

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"math"
	"strconv"
	"strings"

	"nuhabit/backend/internal/modules/possales/internal/jsrow"
)

// jsParse is JSON.parse: objects become *jsrow.Row (keys in document order, a
// duplicate key keeps its first position and its last value), arrays []any,
// numbers float64. Re-marshalling the result with jsrow.Marshal prints numbers
// the way JSON.stringify does, so `1.00` from a json/jsonb column comes out
// as `1`, as it does after node-postgres parses the column.
func jsParse(raw []byte) (any, error) {
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	v, err := jsDecode(dec)
	if err != nil {
		return nil, err
	}
	if _, err := dec.Token(); err != io.EOF {
		return nil, errors.New("unexpected data after JSON value")
	}
	return v, nil
}

func jsDecode(dec *json.Decoder) (any, error) {
	tok, err := dec.Token()
	if err != nil {
		return nil, err
	}
	switch t := tok.(type) {
	case json.Delim:
		if t == '[' {
			arr := []any{}
			for dec.More() {
				v, err := jsDecode(dec)
				if err != nil {
					return nil, err
				}
				arr = append(arr, v)
			}
			_, err := dec.Token()
			return arr, err
		}
		obj := jsrow.New()
		for dec.More() {
			keyTok, err := dec.Token()
			if err != nil {
				return nil, err
			}
			v, err := jsDecode(dec)
			if err != nil {
				return nil, err
			}
			obj.Set(keyTok.(string), v)
		}
		_, err := dec.Token()
		return obj, err
	case json.Number:
		return strconv.ParseFloat(t.String(), 64)
	}
	return tok, nil
}

// jsNormalize re-encodes a json/jsonb column value as node-postgres +
// JSON.stringify would (see jsParse). NULL stays nil.
func jsNormalize(v any) (any, error) {
	raw, ok := v.(json.RawMessage)
	if !ok {
		return v, nil
	}
	return jsParse(raw)
}

// jsTruthy is JS truthiness of a parsed JSON value.
func jsTruthy(v any) bool {
	switch t := v.(type) {
	case nil:
		return false
	case bool:
		return t
	case float64:
		return t != 0 && !math.IsNaN(t)
	case string:
		return t != ""
	}
	return true
}

// jsString is String(v) for the scalar values JSON yields.
func jsString(v any) string {
	switch t := v.(type) {
	case nil:
		return "null"
	case string:
		return t
	case bool:
		return strconv.FormatBool(t)
	case float64:
		b, _ := json.Marshal(t)
		return string(b)
	case []any:
		parts := make([]string, len(t))
		for i, e := range t {
			if e != nil {
				parts[i] = jsString(e)
			}
		}
		return strings.Join(parts, ",")
	}
	return "[object Object]"
}

// jsParseInt is parseInt(s, 10); ok is false for NaN.
func jsParseInt(s string) (int64, bool) {
	s = strings.TrimLeft(s, " \t\n\r\v\f")
	end := 0
	if end < len(s) && (s[end] == '+' || s[end] == '-') {
		end++
	}
	start := end
	for end < len(s) && s[end] >= '0' && s[end] <= '9' {
		end++
	}
	if end == start {
		return 0, false
	}
	n, err := strconv.ParseInt(s[:end], 10, 64)
	if err != nil {
		if s[0] == '-' {
			return math.MinInt64, true
		}
		return math.MaxInt64, true
	}
	return n, true
}
