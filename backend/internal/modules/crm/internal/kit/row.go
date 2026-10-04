// Package kit holds the helpers every CRM sub-package shares: node-postgres
// row serialization, the CRM IAM gates and user scope, response envelopes,
// zod-style input errors and the crm_settings default venue.
package kit

import (
	"bytes"
	"context"
	"encoding/json"
	"math"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/platform/database"
)

// Row is one result row serialized the way node-postgres + JSON.stringify
// render it: columns in SELECT order, numeric and bigint as strings, int4
// and float8 as numbers, timestamptz/date as toISOString, json passed
// through. Routes that return `SELECT *` (or a shim .select()) return Rows
// so the contract follows the table instead of a hand-written struct.
type Row struct {
	keys []string
	vals map[string]any
}

// NewRow builds an ordered object from key, value pairs.
func NewRow(kv ...any) *Row {
	r := &Row{vals: map[string]any{}}
	for i := 0; i+1 < len(kv); i += 2 {
		r.Set(kv[i].(string), kv[i+1])
	}
	return r
}

// Keys returns the column names in order.
func (r *Row) Keys() []string { return r.keys }

// Get returns a column value (nil when absent or NULL).
func (r *Row) Get(key string) any { return r.vals[key] }

// Set adds or replaces a column, keeping first-insertion order like a JS
// object literal.
func (r *Row) Set(key string, v any) {
	if _, ok := r.vals[key]; !ok {
		r.keys = append(r.keys, key)
	}
	r.vals[key] = v
}

// Clone returns a shallow copy ({ ...row }).
func (r *Row) Clone() *Row {
	c := &Row{keys: append([]string(nil), r.keys...), vals: make(map[string]any, len(r.vals))}
	for k, v := range r.vals {
		c.vals[k] = v
	}
	return c
}

// Str returns a text column, "" when NULL or not a string.
func (r *Row) Str(key string) string {
	s, _ := r.vals[key].(string)
	return s
}

// StrPtr returns a nullable text column.
func (r *Row) StrPtr(key string) *string {
	if s, ok := r.vals[key].(string); ok {
		return &s
	}
	return nil
}

// Num is Number(value) with non-finite results as 0 (toNumber in TS): it
// reads numbers and numeric strings.
func (r *Row) Num(key string) float64 { return ToNumber(r.vals[key]) }

// Bool returns a boolean column (false when NULL).
func (r *Row) Bool(key string) bool {
	b, _ := r.vals[key].(bool)
	return b
}

// Time returns a timestamptz/date column.
func (r *Row) Time(key string) (time.Time, bool) {
	t, ok := r.vals[key].(JSTime)
	return time.Time(t), ok
}

// JSON returns a json/jsonb column decoded into a generic value.
func (r *Row) JSON(key string) any {
	raw, ok := r.vals[key].(json.RawMessage)
	if !ok {
		return nil
	}
	var v any
	_ = json.Unmarshal(raw, &v)
	return v
}

// MarshalJSON writes the columns in order.
func (r *Row) MarshalJSON() ([]byte, error) {
	var buf bytes.Buffer
	buf.WriteByte('{')
	for i, k := range r.keys {
		if i > 0 {
			buf.WriteByte(',')
		}
		kb, _ := MarshalNoEscape(k)
		buf.Write(kb)
		buf.WriteByte(':')
		vb, err := MarshalNoEscape(r.vals[k])
		if err != nil {
			return nil, err
		}
		buf.Write(vb)
	}
	buf.WriteByte('}')
	return buf.Bytes(), nil
}

// MarshalNoEscape is json.Marshal without HTML escaping (JSON.stringify).
func MarshalNoEscape(v any) ([]byte, error) {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(v); err != nil {
		return nil, err
	}
	return bytes.TrimRight(buf.Bytes(), "\n"), nil
}

// ToNumber mirrors toNumber in lib/crm/server.ts: Number(value) when
// finite, else 0.
func ToNumber(v any) float64 {
	switch x := v.(type) {
	case nil:
		return 0
	case float64:
		if math.IsNaN(x) || math.IsInf(x, 0) {
			return 0
		}
		return x
	case int:
		return float64(x)
	case int64:
		return float64(x)
	case int32:
		return float64(x)
	case bool:
		if x {
			return 1
		}
		return 0
	case json.Number:
		f, err := x.Float64()
		if err != nil {
			return 0
		}
		return f
	case string:
		s := strings.TrimSpace(x)
		if s == "" {
			return 0
		}
		f, err := strconv.ParseFloat(s, 64)
		if err != nil || math.IsNaN(f) || math.IsInf(f, 0) {
			return 0
		}
		return f
	}
	return 0
}

// JSTime marshals like Date.prototype.toJSON.
type JSTime time.Time

// MarshalJSON writes toISOString.
func (t JSTime) MarshalJSON() ([]byte, error) {
	return []byte(`"` + ISO(time.Time(t)) + `"`), nil
}

// ISO is Date.prototype.toISOString.
func ISO(t time.Time) string { return t.UTC().Format("2006-01-02T15:04:05.000Z") }

// textFormat asks PostgreSQL for every column in text form, which is what
// node-postgres parses; numeric keeps its scale ("10.50") that way.
var textFormat = pgx.QueryResultFormats{pgx.TextFormatCode}

// Query runs sql and returns every row as a Row.
func Query(ctx context.Context, q database.Querier, sql string, args ...any) ([]*Row, error) {
	rows, err := q.Query(ctx, sql, append([]any{textFormat}, args...)...)
	if err != nil {
		return nil, err
	}
	return CollectRows(rows)
}

// QueryOne returns the first row, or nil when there is none.
func QueryOne(ctx context.Context, q database.Querier, sql string, args ...any) (*Row, error) {
	rows, err := Query(ctx, q, sql, args...)
	if err != nil || len(rows) == 0 {
		return nil, err
	}
	return rows[0], nil
}

// CollectRows converts rows fetched in text format (see Query).
func CollectRows(rows pgx.Rows) ([]*Row, error) {
	defer rows.Close()
	fields := rows.FieldDescriptions()
	out := []*Row{}
	for rows.Next() {
		raw := rows.RawValues()
		row := &Row{vals: make(map[string]any, len(fields))}
		for i, f := range fields {
			if raw[i] == nil {
				row.Set(f.Name, nil)
				continue
			}
			row.Set(f.Name, parseText(f.DataTypeOID, string(raw[i])))
		}
		out = append(out, row)
	}
	return out, rows.Err()
}

// node-postgres array element parsers by array OID.
var arrayElem = map[uint32]uint32{
	1000: 16, 1005: 21, 1007: 23, 1016: 20, 1021: 700, 1022: 701, 1231: 1700,
	1009: 25, 1015: 1043, 1014: 1042, 2951: 2950, 1182: 1082, 1115: 1114, 1185: 1184,
	199: 114, 3807: 3802, 1028: 26,
}

func parseText(oid uint32, s string) any {
	switch oid {
	case 16:
		return s == "t" || s == "true"
	case 21, 23, 26:
		n, err := strconv.ParseInt(s, 10, 64)
		if err != nil {
			return s
		}
		return n
	case 700, 701:
		f, err := strconv.ParseFloat(s, 64)
		if err != nil || math.IsNaN(f) || math.IsInf(f, 0) {
			return nil // JSON.stringify(NaN|Infinity) is null
		}
		return f
	case 114, 3802:
		return JSJSON([]byte(s))
	case 1082:
		if t, err := time.ParseInLocation("2006-01-02", s, time.Local); err == nil {
			return JSTime(t)
		}
		return s
	case 1114:
		if t, err := time.ParseInLocation("2006-01-02 15:04:05.999999", s, time.Local); err == nil {
			return JSTime(t)
		}
		return s
	case 1184:
		if t, ok := parseTimestamptz(s); ok {
			return JSTime(t)
		}
		return s
	}
	if elem, ok := arrayElem[oid]; ok {
		items, ok := parseArrayLiteral(s)
		if !ok {
			return s
		}
		out := make([]any, len(items))
		for i, it := range items {
			if it == nil {
				continue
			}
			out[i] = parseText(elem, *it)
		}
		return out
	}
	return s
}

func parseTimestamptz(s string) (time.Time, bool) {
	// PostgreSQL prints "2026-10-04 10:00:00.123+07" (offset may carry minutes).
	for _, layout := range []string{"2006-01-02 15:04:05.999999-07", "2006-01-02 15:04:05.999999-07:00", "2006-01-02 15:04:05.999999-07:00:00"} {
		if t, err := time.Parse(layout, s); err == nil {
			return t, true
		}
	}
	return time.Time{}, false
}

// parseArrayLiteral parses a one-dimensional PostgreSQL array literal.
func parseArrayLiteral(s string) ([]*string, bool) {
	if len(s) < 2 || s[0] != '{' || s[len(s)-1] != '}' {
		return nil, false
	}
	body := s[1 : len(s)-1]
	out := []*string{}
	if body == "" {
		return out, true
	}
	var cur strings.Builder
	quoted, inQuote, escaped := false, false, false
	flush := func() {
		v := cur.String()
		if !quoted && v == "NULL" {
			out = append(out, nil)
		} else {
			out = append(out, &v)
		}
		cur.Reset()
		quoted = false
	}
	for i := 0; i < len(body); i++ {
		c := body[i]
		switch {
		case escaped:
			cur.WriteByte(c)
			escaped = false
		case c == '\\':
			escaped = true
		case c == '"':
			inQuote = !inQuote
			quoted = true
		case c == ',' && !inQuote:
			flush()
		case c == '{' && !inQuote:
			return nil, false // multi-dimensional: keep the literal
		default:
			cur.WriteByte(c)
		}
	}
	flush()
	return out, true
}
