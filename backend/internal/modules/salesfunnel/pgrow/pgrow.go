// Package pgrow serializes query results the way node-postgres hands them
// to JSON.stringify: columns in SELECT order, numeric and bigint as strings,
// int2/int4 and float as numbers, timestamptz and date as toISOString, json
// passed through in JS form. The sales-funnel libs return raw rows, so the
// read models stay rows and the contract follows the SQL.
package pgrow

import (
	"bytes"
	"context"
	"encoding/json"
	"math"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/platform/database"
)

// Row is one ordered result row.
type Row struct {
	keys []string
	vals map[string]any
}

// New builds an ordered object from key, value pairs.
func New(kv ...any) *Row {
	r := &Row{vals: map[string]any{}}
	for i := 0; i+1 < len(kv); i += 2 {
		r.Set(kv[i].(string), kv[i+1])
	}
	return r
}

// Set adds or replaces a key, keeping first-insertion order like a JS object.
func (r *Row) Set(key string, v any) *Row {
	if _, ok := r.vals[key]; !ok {
		r.keys = append(r.keys, key)
	}
	r.vals[key] = v
	return r
}

// Delete removes a key (delete row.key).
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

// Get returns a value (nil when absent or NULL).
func (r *Row) Get(key string) any { return r.vals[key] }

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

// Bool returns a boolean column (false when NULL).
func (r *Row) Bool(key string) bool {
	b, _ := r.vals[key].(bool)
	return b
}

// Num is Number(value): numbers and numeric strings; NULL is 0, a string
// that is not a number is NaN.
func (r *Row) Num(key string) float64 { return ToNumber(r.vals[key]) }

// Time returns a timestamptz/date column.
func (r *Row) Time(key string) (time.Time, bool) {
	t, ok := r.vals[key].(JSTime)
	return time.Time(t), ok
}

// JSON decodes a json/jsonb column into a generic value (nil when NULL).
func (r *Row) JSON(key string) any {
	raw, ok := r.vals[key].(json.RawMessage)
	if !ok {
		return nil
	}
	var v any
	_ = json.Unmarshal(raw, &v)
	return v
}

// MarshalJSON writes the keys in order.
func (r *Row) MarshalJSON() ([]byte, error) {
	var buf bytes.Buffer
	buf.WriteByte('{')
	for i, k := range r.keys {
		if i > 0 {
			buf.WriteByte(',')
		}
		kb, _ := Marshal(k)
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

// ToNumber is Number(value) for row values.
func ToNumber(v any) float64 {
	switch x := v.(type) {
	case nil:
		return 0
	case float64:
		return x
	case int64:
		return float64(x)
	case int:
		return float64(x)
	case bool:
		if x {
			return 1
		}
		return 0
	case string:
		s := strings.TrimSpace(x)
		if s == "" {
			return 0
		}
		f, err := strconv.ParseFloat(s, 64)
		if err != nil {
			return math.NaN()
		}
		return f
	}
	return math.NaN()
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

// Query runs sql and returns every row.
func Query(ctx context.Context, q database.Querier, sql string, args ...any) ([]*Row, error) {
	rows, err := q.Query(ctx, sql, append([]any{textFormat}, args...)...)
	if err != nil {
		return nil, err
	}
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

// QueryOne returns the first row, or nil when there is none.
func QueryOne(ctx context.Context, q database.Querier, sql string, args ...any) (*Row, error) {
	rows, err := Query(ctx, q, sql, args...)
	if err != nil || len(rows) == 0 {
		return nil, err
	}
	return rows[0], nil
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
			return nil
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
		for _, layout := range []string{"2006-01-02 15:04:05.999999-07", "2006-01-02 15:04:05.999999-07:00", "2006-01-02 15:04:05.999999-07:00:00"} {
			if t, err := time.Parse(layout, s); err == nil {
				return JSTime(t)
			}
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
			if it != nil {
				out[i] = parseText(elem, *it)
			}
		}
		return out
	}
	return s
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
			return nil, false
		default:
			cur.WriteByte(c)
		}
	}
	flush()
	return out, true
}

// JSJSON rewrites JSON text the way JSON.stringify(JSON.parse(text)) would:
// key order kept (array-index keys first), numbers in their JS form. The
// input is returned unchanged when it does not parse.
func JSJSON(raw []byte) json.RawMessage {
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	var out bytes.Buffer
	if err := reencode(dec, &out); err != nil {
		return json.RawMessage(raw)
	}
	return json.RawMessage(out.Bytes())
}

func reencode(dec *json.Decoder, out *bytes.Buffer) error {
	tok, err := dec.Token()
	if err != nil {
		return err
	}
	switch t := tok.(type) {
	case json.Delim:
		if t == '[' {
			out.WriteByte('[')
			for i := 0; dec.More(); i++ {
				if i > 0 {
					out.WriteByte(',')
				}
				if err := reencode(dec, out); err != nil {
					return err
				}
			}
			out.WriteByte(']')
			_, err := dec.Token()
			return err
		}
		type member struct {
			key   string
			index int64
			value []byte
		}
		var indexed, named []member
		for dec.More() {
			key, err := dec.Token()
			if err != nil {
				return err
			}
			var v bytes.Buffer
			if err := reencode(dec, &v); err != nil {
				return err
			}
			m := member{key: key.(string), value: v.Bytes()}
			if n, ok := arrayIndex(m.key); ok {
				m.index = n
				indexed = append(indexed, m)
			} else {
				named = append(named, m)
			}
		}
		if _, err := dec.Token(); err != nil {
			return err
		}
		sort.SliceStable(indexed, func(i, j int) bool { return indexed[i].index < indexed[j].index })
		out.WriteByte('{')
		for i, m := range append(indexed, named...) {
			if i > 0 {
				out.WriteByte(',')
			}
			kb, _ := Marshal(m.key)
			out.Write(kb)
			out.WriteByte(':')
			out.Write(m.value)
		}
		out.WriteByte('}')
	case json.Number:
		f, err := strconv.ParseFloat(string(t), 64)
		if err != nil {
			return err
		}
		b, err := json.Marshal(f)
		if err != nil {
			return err
		}
		out.Write(b)
	default:
		b, err := Marshal(t)
		if err != nil {
			return err
		}
		out.Write(b)
	}
	return nil
}

func arrayIndex(key string) (int64, bool) {
	if key == "" || (len(key) > 1 && key[0] == '0') {
		return 0, false
	}
	n, err := strconv.ParseInt(key, 10, 64)
	if err != nil || n < 0 || n > 4294967294 || strconv.FormatInt(n, 10) != key {
		return 0, false
	}
	return n, true
}
