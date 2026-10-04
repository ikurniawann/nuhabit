// Package jsrow serializes query results the way node-postgres + JSON.stringify
// render them in the TS routes, so a `select('*')` port keeps every column, in
// table order, with the same JSON types:
//
//   - numeric and int8 arrive as strings (node-postgres sets no type parsers),
//   - int2/int4/float4/float8 as numbers, bool as booleans,
//   - timestamptz/timestamp/date as Date.toISOString() ("…T…:…:….000Z"),
//   - json/jsonb passed through untouched, everything else (text, uuid, enums,
//     time) as the PostgreSQL text form.
//
// Embedded relations built with row_to_json/json_agg in SQL are json columns,
// so they come out exactly as PostgreSQL renders them, as in the TS shim.
package jsrow

import (
	"bytes"
	"context"
	"database/sql/driver"
	"encoding/json"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/platform/database"
)

// Row is one result row with its columns in SELECT order. It marshals as a
// JSON object in that order; Set keeps first-insertion order like a JS spread.
type Row struct {
	keys []string
	vals map[string]any
}

// New returns an empty row.
func New() *Row { return &Row{vals: map[string]any{}} }

// Object builds a row from key, value pairs.
func Object(kv ...any) *Row {
	r := New()
	for i := 0; i+1 < len(kv); i += 2 {
		r.Set(kv[i].(string), kv[i+1])
	}
	return r
}

// Set adds or replaces a column.
func (r *Row) Set(key string, v any) *Row {
	if _, ok := r.vals[key]; !ok {
		r.keys = append(r.keys, key)
	}
	r.vals[key] = v
	return r
}

// Delete removes a column (JS `delete row.key`).
func (r *Row) Delete(key string) {
	if _, ok := r.vals[key]; !ok {
		return
	}
	delete(r.vals, key)
	for i, k := range r.keys {
		if k == key {
			r.keys = append(r.keys[:i], r.keys[i+1:]...)
			break
		}
	}
}

// Has reports whether the column exists (even when NULL).
func (r *Row) Has(key string) bool {
	_, ok := r.vals[key]
	return ok
}

// Keys returns the column names in order.
func (r *Row) Keys() []string { return append([]string(nil), r.keys...) }

// Get returns the raw value (nil when absent or NULL).
func (r *Row) Get(key string) any { return r.vals[key] }

// Str returns a string column ("" when NULL or not a string).
func (r *Row) Str(key string) string {
	s, _ := r.vals[key].(string)
	return s
}

// StrPtr returns a string column, nil when NULL.
func (r *Row) StrPtr(key string) *string {
	if s, ok := r.vals[key].(string); ok {
		return &s
	}
	return nil
}

// Num is Number(value) for numeric/int/float columns (0 when NULL or NaN),
// matching `Number(row.x) || 0` in the TS.
func (r *Row) Num(key string) float64 { return ToNumber(r.vals[key]) }

// Time returns a timestamp column (zero when NULL).
func (r *Row) Time(key string) time.Time {
	if t, ok := r.vals[key].(JSTime); ok {
		return time.Time(t)
	}
	return time.Time{}
}

// Clone returns a shallow copy.
func (r *Row) Clone() *Row {
	c := New()
	for _, k := range r.keys {
		c.Set(k, r.vals[k])
	}
	return c
}

// MarshalJSON writes the columns in order without HTML escaping.
func (r *Row) MarshalJSON() ([]byte, error) {
	var buf bytes.Buffer
	buf.WriteByte('{')
	for i, k := range r.keys {
		if i > 0 {
			buf.WriteByte(',')
		}
		kb, _ := json.Marshal(k)
		buf.Write(kb)
		buf.WriteByte(':')
		vb, err := Marshal(r.vals[k])
		if err != nil {
			return nil, err
		}
		buf.Write(vb)
	}
	buf.WriteByte('}')
	return buf.Bytes(), nil
}

// Marshal is json.Marshal without HTML escaping (JSON.stringify).
func Marshal(v any) ([]byte, error) {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(v); err != nil {
		return nil, err
	}
	return bytes.TrimRight(buf.Bytes(), "\n"), nil
}

// JSTime marshals like Date.prototype.toJSON: UTC with milliseconds.
type JSTime time.Time

func (t JSTime) MarshalJSON() ([]byte, error) {
	return []byte(`"` + time.Time(t).UTC().Format("2006-01-02T15:04:05.000Z") + `"`), nil
}

// ToNumber mirrors JS Number(x) for the values a Row holds, with NaN as 0.
func ToNumber(v any) float64 {
	switch x := v.(type) {
	case nil:
		return 0
	case float64:
		return x
	case int:
		return float64(x)
	case int64:
		return float64(x)
	case bool:
		if x {
			return 1
		}
		return 0
	case string:
		f, err := strconv.ParseFloat(strings.TrimSpace(x), 64)
		if err != nil {
			return 0
		}
		return f
	case json.Number:
		f, _ := x.Float64()
		return f
	case json.RawMessage:
		var f float64
		if json.Unmarshal(x, &f) == nil {
			return f
		}
	}
	return 0
}

// PostgreSQL type OIDs the converter treats specially.
const (
	oidBool        = 16
	oidInt8        = 20
	oidInt2        = 21
	oidInt4        = 23
	oidOID         = 26
	oidJSON        = 114
	oidFloat4      = 700
	oidFloat8      = 701
	oidDate        = 1082
	oidTimestamp   = 1114
	oidTimestamptz = 1184
	oidNumeric     = 1700
	oidJSONB       = 3802
)

// textResults asks for every column in text format so numeric keeps its
// scale exactly as PostgreSQL prints it ("15000.00").
var textResults = pgx.QueryResultFormats{pgx.TextFormatCode}

// Query runs sql and collects every row.
func Query(ctx context.Context, q database.Querier, sql string, args ...any) ([]*Row, error) {
	rows, err := q.Query(ctx, sql, append([]any{textResults}, args...)...)
	if err != nil {
		return nil, err
	}
	return Collect(rows)
}

// QueryOne returns the first row, or nil when there is none.
func QueryOne(ctx context.Context, q database.Querier, sql string, args ...any) (*Row, error) {
	rows, err := Query(ctx, q, sql, args...)
	if err != nil || len(rows) == 0 {
		return nil, err
	}
	return rows[0], nil
}

// Collect reads every row of rows (which must use text result formats).
func Collect(rows pgx.Rows) ([]*Row, error) {
	defer rows.Close()
	fields := rows.FieldDescriptions()
	out := []*Row{}
	for rows.Next() {
		raw := rows.RawValues()
		var vals []any
		row := New()
		for i, f := range fields {
			if raw[i] == nil {
				row.Set(f.Name, nil)
				continue
			}
			v, ok := convert(f.DataTypeOID, string(raw[i]))
			if !ok {
				if vals == nil {
					var err error
					if vals, err = rows.Values(); err != nil {
						return nil, err
					}
				}
				v = nodeValue(vals[i])
			}
			row.Set(f.Name, v)
		}
		out = append(out, row)
	}
	return out, rows.Err()
}

// convert maps one text-format value; ok is false for types (arrays) that
// need pgx's decoder.
func convert(oid uint32, s string) (any, bool) {
	switch oid {
	case oidBool:
		return s == "t", true
	case oidInt2, oidInt4, oidOID, oidFloat4, oidFloat8:
		f, err := strconv.ParseFloat(s, 64)
		if err != nil {
			return s, true
		}
		return f, true
	case oidInt8, oidNumeric:
		return s, true
	case oidJSON, oidJSONB:
		return NormalizeJSON([]byte(s)), true
	case oidTimestamptz:
		if t, ok := parseTime(s, true); ok {
			return JSTime(t), true
		}
		return s, true
	case oidTimestamp:
		if t, ok := parseTime(s, false); ok {
			return JSTime(t), true
		}
		return s, true
	case oidDate:
		if t, err := time.Parse("2006-01-02", s); err == nil {
			return JSTime(t), true
		}
		return s, true
	}
	if strings.HasPrefix(s, "{") && isArrayOID(oid) {
		return nil, false
	}
	return s, true
}

func parseTime(s string, withZone bool) (time.Time, bool) {
	layouts := []string{"2006-01-02 15:04:05.999999999"}
	if withZone {
		layouts = []string{"2006-01-02 15:04:05.999999999Z07", "2006-01-02 15:04:05.999999999Z07:00", "2006-01-02 15:04:05.999999999Z07:00:00"}
	}
	for _, l := range layouts {
		if t, err := time.Parse(l, s); err == nil {
			return t, true
		}
	}
	return time.Time{}, false
}

// isArrayOID covers the array types the POS tables use.
func isArrayOID(oid uint32) bool {
	switch oid {
	case 1000, 1005, 1007, 1016, 1009, 1015, 1021, 1022, 1231, 2951, 1115, 1182, 1185, 199, 3807:
		return true
	}
	return false
}

// nodeValue converts a pgx-decoded value to what node-postgres hands to JSON.stringify.
func nodeValue(v any) any {
	switch x := v.(type) {
	case nil:
		return nil
	case time.Time:
		return JSTime(x)
	case [16]byte:
		return uuidString(x)
	case int64:
		return strconv.FormatInt(x, 10)
	case int32:
		return float64(x)
	case int16:
		return float64(x)
	case []any:
		out := make([]any, len(x))
		for i, e := range x {
			out[i] = nodeValue(e)
		}
		return out
	case driver.Valuer:
		if s, err := x.Value(); err == nil {
			return s
		}
	}
	return v
}

func uuidString(b [16]byte) string {
	const hex = "0123456789abcdef"
	out := make([]byte, 0, 36)
	for i, c := range b {
		if i == 4 || i == 6 || i == 8 || i == 10 {
			out = append(out, '-')
		}
		out = append(out, hex[c>>4], hex[c&0xf])
	}
	return string(out)
}
