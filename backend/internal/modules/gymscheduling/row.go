package gymscheduling

import (
	"bytes"
	"encoding/json"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// Row is one result row serialized the way node-postgres + JSON.stringify
// render it in the TS routes: columns in SELECT order, timestamptz as
// "2006-01-02T15:04:05.000Z", bigint as a string, json/jsonb
// passed through untouched. Read models return rows as-is, so the JSON
// contract follows the SQL instead of a hand-written struct.
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

// Get returns a column value (nil when absent or NULL).
func (r *Row) Get(key string) any { return r.vals[key] }

// Set adds or replaces a column, keeping first-insertion order like a JS
// object spread.
func (r *Row) Set(key string, v any) {
	if _, ok := r.vals[key]; !ok {
		r.keys = append(r.keys, key)
	}
	r.vals[key] = v
}

// Str returns a string column, "" when NULL.
func (r *Row) Str(key string) string {
	s, _ := r.vals[key].(string)
	return s
}

// StrPtr returns a nullable string column.
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

// Time returns a timestamptz column.
func (r *Row) Time(key string) time.Time {
	if t, ok := r.vals[key].(jsTime); ok {
		return time.Time(t)
	}
	return time.Time{}
}

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

// jsTime marshals like Date.prototype.toJSON: UTC, millisecond precision.
type jsTime time.Time

func (t jsTime) MarshalJSON() ([]byte, error) {
	return []byte(`"` + time.Time(t).UTC().Format("2006-01-02T15:04:05.000Z") + `"`), nil
}

const (
	oidJSON  = 114
	oidJSONB = 3802
)

// collectRows reads every row of rows into Rows.
func collectRows(rows pgx.Rows) ([]*Row, error) {
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

// nodeValue converts a pgx value to what node-postgres would hand to JSON.stringify.
func nodeValue(v any) any {
	switch x := v.(type) {
	case nil:
		return nil
	case time.Time:
		return jsTime(x)
	case [16]byte:
		return fmt.Sprintf("%x-%x-%x-%x-%x", x[0:4], x[4:6], x[6:8], x[8:10], x[10:16])
	case int64:
		return fmt.Sprint(x) // int8 arrives as a string in node-postgres
	case []any:
		out := make([]any, len(x))
		for i, e := range x {
			out[i] = nodeValue(e)
		}
		return out
	}
	return v
}
