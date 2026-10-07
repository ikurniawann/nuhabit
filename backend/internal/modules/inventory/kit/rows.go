// Package kit holds what every inventory sub-area shares: rows serialized the
// way node-postgres hands them to JSON.stringify, the user's business scope
// and active stall, query-string parsing with zod's coercion and messages,
// the TS response envelopes, and small number helpers.
package kit

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"math/big"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
)

// Row is a JSON object with insertion-ordered keys. Rows read from the
// database keep the SELECT column order and node-postgres value types:
// numeric and int8 as strings, int2/int4/float as numbers, date and
// timestamp as toISOString() strings, json/jsonb untouched.
type Row struct {
	keys []string
	vals map[string]any
}

// NewRow returns an empty row.
func NewRow() *Row { return &Row{vals: map[string]any{}} }

// Obj builds a row from key, value pairs (an object literal in TS).
func Obj(kv ...any) *Row {
	r := NewRow()
	for i := 0; i+1 < len(kv); i += 2 {
		r.Set(kv[i].(string), kv[i+1])
	}
	return r
}

// Set adds or replaces a key; a new key goes last, a replaced one keeps its
// place (object spread semantics).
func (r *Row) Set(key string, v any) *Row {
	if _, ok := r.vals[key]; !ok {
		r.keys = append(r.keys, key)
	}
	r.vals[key] = v
	return r
}

// Delete removes a key.
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

// Has reports whether key is present (even when its value is null).
func (r *Row) Has(key string) bool {
	_, ok := r.vals[key]
	return ok
}

// Get returns a value (nil when absent or NULL).
func (r *Row) Get(key string) any { return r.vals[key] }

// Keys returns the keys in order.
func (r *Row) Keys() []string { return r.keys }

// Clone copies the row (values are shared).
func (r *Row) Clone() *Row {
	c := &Row{keys: append([]string(nil), r.keys...), vals: make(map[string]any, len(r.vals))}
	for k, v := range r.vals {
		c.vals[k] = v
	}
	return c
}

// Str returns a string value, "" when NULL or not a string.
func (r *Row) Str(key string) string {
	s, _ := r.vals[key].(string)
	return s
}

// StrPtr returns a nullable string value.
func (r *Row) StrPtr(key string) *string {
	if s, ok := r.vals[key].(string); ok {
		return &s
	}
	return nil
}

// Num returns Number(value) with NaN as 0 (toNumber/toQty in TS).
func (r *Row) Num(key string) float64 { return ToNum(r.vals[key]) }

// NumPtr returns nil for NULL, else Num.
func (r *Row) NumPtr(key string) *float64 {
	if r.vals[key] == nil {
		return nil
	}
	n := r.Num(key)
	return &n
}

// Bool returns a boolean value.
func (r *Row) Bool(key string) bool {
	b, _ := r.vals[key].(bool)
	return b
}

// MarshalJSON writes the keys in order without HTML escaping.
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
		vb, err := marshal(r.vals[k])
		if err != nil {
			return nil, fmt.Errorf("key %s: %w", k, err)
		}
		buf.Write(vb)
	}
	buf.WriteByte('}')
	return buf.Bytes(), nil
}

func marshal(v any) ([]byte, error) {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(v); err != nil {
		return nil, err
	}
	return bytes.TrimRight(buf.Bytes(), "\n"), nil
}

// Rows is a JSON array of rows that renders [] when empty.
type Rows []*Row

// MarshalJSON keeps an empty list as [].
func (rs Rows) MarshalJSON() ([]byte, error) {
	if len(rs) == 0 {
		return []byte("[]"), nil
	}
	return marshal([]*Row(rs))
}

const (
	oidJSON  = 114
	oidJSONB = 3802
)

// Collect reads every row into Rows, closing rows.
func Collect(rows pgx.Rows) (Rows, error) {
	defer rows.Close()
	fields := rows.FieldDescriptions()
	out := Rows{}
	for rows.Next() {
		vals, err := rows.Values()
		if err != nil {
			return nil, err
		}
		raw := rows.RawValues()
		row := &Row{keys: make([]string, 0, len(fields)), vals: make(map[string]any, len(fields))}
		for i, f := range fields {
			if f.DataTypeOID == pgtype.NumericOID && f.Format == pgtype.TextFormatCode {
				// PostgreSQL's own text keeps the scale of a zero (0.000),
				// which the binary decoder drops.
				if raw[i] == nil {
					row.Set(f.Name, nil)
				} else {
					row.Set(f.Name, string(raw[i]))
				}
				continue
			}
			if f.DataTypeOID == oidJSON || f.DataTypeOID == oidJSONB {
				row.Set(f.Name, rawJSON(raw[i], f.Format, f.DataTypeOID))
				continue
			}
			row.Set(f.Name, NodeValue(vals[i]))
		}
		out = append(out, row)
	}
	return out, rows.Err()
}

// numericAsText asks PostgreSQL for numeric columns in text form, as
// node-postgres receives them.
var numericAsText = pgx.QueryResultFormatsByOID{pgtype.NumericOID: pgtype.TextFormatCode}

// Query runs sql and collects the rows.
func Query(ctx context.Context, q database.Querier, sql string, args ...any) (Rows, error) {
	rows, err := q.Query(ctx, sql, append([]any{numericAsText}, args...)...)
	if err != nil {
		return nil, err
	}
	return Collect(rows)
}

// QueryOne returns the first row or nil (queryOne in TS).
func QueryOne(ctx context.Context, q database.Querier, sql string, args ...any) (*Row, error) {
	rows, err := Query(ctx, q, sql, args...)
	if err != nil || len(rows) == 0 {
		return nil, err
	}
	return rows[0], nil
}

func rawJSON(b []byte, format int16, oid uint32) any {
	if b == nil {
		return nil
	}
	// Binary jsonb carries a one-byte version prefix before the text.
	if oid == oidJSONB && format == pgtype.BinaryFormatCode && len(b) > 0 {
		b = b[1:]
	}
	return normalizeJSON(b)
}

// normalizeJSON re-encodes a json column the way JSON.parse then
// JSON.stringify would: key order kept, numbers in JS form (1.0000 → 1).
func normalizeJSON(b []byte) json.RawMessage {
	dec := json.NewDecoder(bytes.NewReader(b))
	dec.UseNumber()
	var out bytes.Buffer
	if err := copyJSON(dec, &out); err != nil {
		return json.RawMessage(append([]byte(nil), b...))
	}
	return json.RawMessage(out.Bytes())
}

func copyJSON(dec *json.Decoder, out *bytes.Buffer) error {
	tok, err := dec.Token()
	if err != nil {
		return err
	}
	switch t := tok.(type) {
	case json.Delim:
		closing := byte('}')
		if t == '[' {
			closing = ']'
		}
		out.WriteByte(byte(t))
		for i := 0; dec.More(); i++ {
			if i > 0 {
				out.WriteByte(',')
			}
			if t == '{' {
				key, err := dec.Token()
				if err != nil {
					return err
				}
				kb, _ := marshal(key)
				out.Write(kb)
				out.WriteByte(':')
			}
			if err := copyJSON(dec, out); err != nil {
				return err
			}
		}
		if _, err := dec.Token(); err != nil {
			return err
		}
		out.WriteByte(closing)
	case json.Number:
		f, err := t.Float64()
		if err != nil {
			return err
		}
		out.WriteString(JSNum(f))
	default:
		vb, err := marshal(t)
		if err != nil {
			return err
		}
		out.Write(vb)
	}
	return nil
}

// NodeValue converts a pgx value to what node-postgres gives JSON.stringify.
func NodeValue(v any) any {
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
		if !x.Valid {
			return nil
		}
		return NumericText(x)
	case []any:
		out := make([]any, len(x))
		for i, e := range x {
			out[i] = NodeValue(e)
		}
		return out
	}
	return v
}

// NumericText renders a numeric the way PostgreSQL's text output does
// (scale preserved: 12.500).
func NumericText(n pgtype.Numeric) string {
	if n.NaN {
		return "NaN"
	}
	switch n.InfinityModifier {
	case pgtype.Infinity:
		return "Infinity"
	case pgtype.NegativeInfinity:
		return "-Infinity"
	}
	i := n.Int
	if i == nil {
		i = big.NewInt(0)
	}
	digits := new(big.Int).Abs(i).String()
	sign := ""
	if i.Sign() < 0 {
		sign = "-"
	}
	if n.Exp >= 0 {
		if i.Sign() == 0 {
			return "0"
		}
		return sign + digits + strings.Repeat("0", int(n.Exp))
	}
	scale := int(-n.Exp)
	if len(digits) <= scale {
		digits = strings.Repeat("0", scale-len(digits)+1) + digits
	}
	return sign + digits[:len(digits)-scale] + "." + digits[len(digits)-scale:]
}
