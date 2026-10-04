package recruitment

import (
	"bytes"
	"encoding/json"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"nuhabit/backend/internal/platform/httpx"
)

// Row is one result row as node-postgres + JSON.stringify render it: columns
// in SELECT order, timestamptz and date as Date.toJSON, numeric and bigint as
// strings, int4 and float8 as numbers, json/jsonb passed through. Most
// recruitment routes return query rows as-is, so the JSON contract follows
// the SQL instead of a hand-written struct.
type Row struct {
	keys []string
	vals map[string]any
}

func newRow() *Row { return &Row{vals: map[string]any{}} }

// object builds an ordered JSON object from key, value pairs.
func object(kv ...any) *Row {
	r := newRow()
	for i := 0; i+1 < len(kv); i += 2 {
		r.Set(kv[i].(string), kv[i+1])
	}
	return r
}

// Set adds or replaces a key, keeping first-insertion order like an object spread.
func (r *Row) Set(key string, v any) {
	if _, ok := r.vals[key]; !ok {
		r.keys = append(r.keys, key)
	}
	r.vals[key] = v
}

// Get returns a column value (nil when absent or NULL).
func (r *Row) Get(key string) any { return r.vals[key] }

// Str returns a text or uuid column, "" when NULL.
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

// Int returns an int4 column, 0 when NULL.
func (r *Row) Int(key string) int {
	v, _ := r.vals[key].(int32)
	return int(v)
}

// Bool returns a boolean column, false when NULL.
func (r *Row) Bool(key string) bool {
	v, _ := r.vals[key].(bool)
	return v
}

// Time returns a timestamptz column, nil when NULL.
func (r *Row) Time(key string) *time.Time {
	if t, ok := r.vals[key].(httpx.JSTime); ok {
		tt := time.Time(t)
		return &tt
	}
	return nil
}

// JSON decodes a json/jsonb column into dst (no-op when NULL).
func (r *Row) JSON(key string, dst any) error {
	raw, ok := r.vals[key].(json.RawMessage)
	if !ok {
		return nil
	}
	return json.Unmarshal(raw, dst)
}

// MarshalJSON writes the keys in insertion order.
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
		vb, err := marshalNoEscape(r.vals[k])
		if err != nil {
			return nil, err
		}
		buf.Write(vb)
	}
	buf.WriteByte('}')
	return buf.Bytes(), nil
}

func marshalNoEscape(v any) ([]byte, error) {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(v); err != nil {
		return nil, err
	}
	return bytes.TrimRight(buf.Bytes(), "\n"), nil
}

const (
	oidJSON  = 114
	oidJSONB = 3802
)

// collect reads every row; a query error passes through.
func collect(rows pgx.Rows, err error) ([]*Row, error) {
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	fields := rows.FieldDescriptions()
	out := []*Row{}
	for rows.Next() {
		vals, err := rows.Values()
		if err != nil {
			return nil, err
		}
		raw := rows.RawValues()
		row := newRow()
		for i, f := range fields {
			if f.DataTypeOID == oidJSON || f.DataTypeOID == oidJSONB {
				row.Set(f.Name, rawJSON(raw[i], f.Format, f.DataTypeOID))
				continue
			}
			row.Set(f.Name, nodeValue(vals[i]))
		}
		out = append(out, row)
	}
	return out, rows.Err()
}

// collectOne is queryOne: the first row, or nil.
func collectOne(rows pgx.Rows, err error) (*Row, error) {
	all, err := collect(rows, err)
	if err != nil || len(all) == 0 {
		return nil, err
	}
	return all[0], nil
}

func rawJSON(b []byte, format int16, oid uint32) any {
	if b == nil {
		return nil
	}
	// Binary jsonb carries a one-byte version prefix before the text.
	if oid == oidJSONB && format == pgtype.BinaryFormatCode && len(b) > 0 {
		b = b[1:]
	}
	return json.RawMessage(append([]byte(nil), b...))
}

// nodeValue converts a pgx value to what node-postgres hands JSON.stringify.
func nodeValue(v any) any {
	switch x := v.(type) {
	case nil:
		return nil
	case time.Time:
		return httpx.JSTime(x)
	case [16]byte:
		return fmt.Sprintf("%x-%x-%x-%x-%x", x[0:4], x[4:6], x[6:8], x[8:10], x[10:16])
	case int64:
		return fmt.Sprint(x) // int8 arrives as a string in node-postgres
	case pgtype.Numeric:
		s, err := x.Value()
		if err != nil || s == nil {
			return nil
		}
		return s
	case []any:
		out := make([]any, len(x))
		for i, e := range x {
			out[i] = nodeValue(e)
		}
		return out
	}
	return v
}
