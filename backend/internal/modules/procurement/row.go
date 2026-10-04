package procurement

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
)

// Row is one result row as node-postgres hands it to JSON.stringify: columns
// in SELECT order, timestamptz as toISOString, int8 and numeric as strings,
// json/jsonb untouched. The TS libs mostly `select("*")` and spread extra
// keys onto the row, so the read models stay rows instead of structs.
type Row struct {
	keys []string
	vals map[string]any
}

func newRow() *Row { return &Row{vals: map[string]any{}} }

// obj builds an ordered object from key, value pairs.
func obj(kv ...any) *Row {
	r := newRow()
	for i := 0; i+1 < len(kv); i += 2 {
		r.Set(kv[i].(string), kv[i+1])
	}
	return r
}

// Set adds or replaces a key, keeping first-insertion order like a JS spread.
func (r *Row) Set(key string, v any) *Row {
	if _, ok := r.vals[key]; !ok {
		r.keys = append(r.keys, key)
	}
	r.vals[key] = v
	return r
}

// Get returns a value (nil when absent or NULL).
func (r *Row) Get(key string) any { return r.vals[key] }

// Str returns a string column, "" when NULL or not a string.
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

// Bool returns a boolean column (false when NULL).
func (r *Row) Bool(key string) bool {
	b, _ := r.vals[key].(bool)
	return b
}

// Num is Number(value) for numeric strings, ints and floats (0 when NULL or
// not finite, like the TS toQty/toAmount helpers).
func (r *Row) Num(key string) float64 { return toNum(r.vals[key]) }

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
		vb, err := marshalJS(r.vals[k])
		if err != nil {
			return nil, err
		}
		buf.Write(vb)
	}
	buf.WriteByte('}')
	return buf.Bytes(), nil
}

func marshalJS(v any) ([]byte, error) {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(v); err != nil {
		return nil, err
	}
	return bytes.TrimRight(buf.Bytes(), "\n"), nil
}

// toNum mirrors Number(x) with a finite fallback of 0.
func toNum(v any) float64 {
	switch x := v.(type) {
	case nil:
		return 0
	case float64:
		return x
	case int:
		return float64(x)
	case int32:
		return float64(x)
	case int16:
		return float64(x)
	case int64:
		return float64(x)
	case json.Number:
		f, err := x.Float64()
		if err != nil {
			return 0
		}
		return f
	case string:
		return jsNumber(x)
	case bool:
		if x {
			return 1
		}
		return 0
	}
	return 0
}

// jsNumber is Number(s) for the strings PostgreSQL produces (0 for "" and
// garbage, as the callers coerce NaN to 0).
func jsNumber(s string) float64 {
	s = strings.TrimSpace(s)
	if s == "" {
		return 0
	}
	f, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return 0
	}
	return f
}

const (
	oidNumeric   = 1700
	oidJSON      = 114
	oidJSONB     = 3802
	oidDate      = 1082
	oidTimestamp = 1114
)

// RowReader converts pgx rows with the process time zone node-postgres uses
// for date and timestamp-without-zone columns (Config.TimeZone).
type RowReader struct{ Loc *time.Location }

// All reads every row.
func (rr RowReader) All(rows pgx.Rows) ([]*Row, error) {
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
			row.Set(f.Name, rr.value(f.DataTypeOID, f.Format, vals[i], raw[i]))
		}
		out = append(out, row)
	}
	return out, rows.Err()
}

// Query runs sql and reads every row.
func (rr RowReader) Query(ctx context.Context, q database.Querier, sql string, args ...any) ([]*Row, error) {
	rows, err := q.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	return rr.All(rows)
}

// One runs sql and returns its first row, or nil when there is none.
func (rr RowReader) One(ctx context.Context, q database.Querier, sql string, args ...any) (*Row, error) {
	rows, err := rr.Query(ctx, q, sql, args...)
	if err != nil || len(rows) == 0 {
		return nil, err
	}
	return rows[0], nil
}

func (rr RowReader) value(oid uint32, format int16, v any, raw []byte) any {
	if v == nil {
		return nil
	}
	switch oid {
	case oidNumeric:
		// node-postgres returns PostgreSQL's text form ("0.00" keeps its
		// scale); pgx drops the scale of a zero, so print the wire value.
		if format == pgtype.BinaryFormatCode {
			if s, ok := numericText(raw); ok {
				return s
			}
		} else if raw != nil {
			return string(raw)
		}
	case oidJSON, oidJSONB:
		b := raw
		if oid == oidJSONB && format == pgtype.BinaryFormatCode && len(b) > 0 {
			b = b[1:] // binary jsonb carries a version byte
		}
		return jsJSON(b)
	case oidDate, oidTimestamp:
		if t, ok := v.(time.Time); ok {
			// node-postgres parses these as local wall-clock time.
			return httpx.JSTime(time.Date(t.Year(), t.Month(), t.Day(), t.Hour(), t.Minute(), t.Second(), t.Nanosecond(), rr.Loc))
		}
	}
	return nodeValue(v)
}

// nodeValue converts a decoded pgx value to what node-postgres returns.
func nodeValue(v any) any {
	switch x := v.(type) {
	case nil:
		return nil
	case time.Time:
		return httpx.JSTime(x)
	case [16]byte:
		return fmt.Sprintf("%x-%x-%x-%x-%x", x[0:4], x[4:6], x[6:8], x[8:10], x[10:16])
	case int64:
		return strconv.FormatInt(x, 10)
	case pgtype.Numeric:
		s, _ := x.Value()
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

// jsJSON is JSON.stringify(JSON.parse(b)): PostgreSQL prints numerics with
// their scale ("1500.00") and json_agg separates elements with ", \n ",
// while node-postgres parses the column and Next re-serializes it.
func jsJSON(b []byte) json.RawMessage {
	dec := json.NewDecoder(bytes.NewReader(b))
	dec.UseNumber()
	var out bytes.Buffer
	if err := copyJSValue(dec, &out); err != nil {
		return json.RawMessage(append([]byte(nil), b...))
	}
	return json.RawMessage(out.Bytes())
}

func copyJSValue(dec *json.Decoder, out *bytes.Buffer) error {
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
				kb, _ := marshalJS(key)
				out.Write(kb)
				out.WriteByte(':')
			}
			if err := copyJSValue(dec, out); err != nil {
				return err
			}
		}
		if _, err := dec.Token(); err != nil && err != io.EOF {
			return err
		}
		out.WriteByte(closing)
	case json.Number:
		f, err := t.Float64()
		if err != nil || math.IsInf(f, 0) {
			out.WriteString("null")
			return nil
		}
		nb, _ := marshalJS(f)
		out.Write(nb)
	default:
		vb, err := marshalJS(t)
		if err != nil {
			return err
		}
		out.Write(vb)
	}
	return nil
}

// decodeRow parses a JSON object into a Row (nested values stay raw JSON in
// node form), so keys can be added the way the TS mutates parsed embeds.
func decodeRow(raw json.RawMessage) (*Row, error) {
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	tok, err := dec.Token()
	if err != nil {
		return nil, err
	}
	if d, ok := tok.(json.Delim); !ok || d != '{' {
		return nil, fmt.Errorf("decodeRow: not an object")
	}
	row := newRow()
	for dec.More() {
		key, err := dec.Token()
		if err != nil {
			return nil, err
		}
		var v json.RawMessage
		if err := dec.Decode(&v); err != nil {
			return nil, err
		}
		var val any = jsJSON(v)
		switch string(v) {
		case "null":
			val = nil
		default:
			var str string
			if json.Unmarshal(v, &str) == nil {
				val = str
			}
		}
		row.Set(key.(string), val)
	}
	return row, nil
}

// numericText prints a binary numeric the way PostgreSQL's numeric_out does.
func numericText(b []byte) (string, bool) {
	if len(b) < 8 {
		return "", false
	}
	u16 := func(i int) uint16 { return uint16(b[i])<<8 | uint16(b[i+1]) }
	ndigits, weight, sign, dscale := int(u16(0)), int(int16(u16(2))), u16(4), int(int16(u16(6)))
	switch sign {
	case 0xC000:
		return "NaN", true
	case 0xD000:
		return "Infinity", true
	case 0xF000:
		return "-Infinity", true
	}
	if len(b) < 8+2*ndigits {
		return "", false
	}
	digit := func(i int) int {
		if i < 0 || i >= ndigits {
			return 0
		}
		return int(u16(8 + 2*i))
	}
	var sb strings.Builder
	if sign == 0x4000 {
		sb.WriteByte('-')
	}
	if weight < 0 {
		sb.WriteByte('0')
	} else {
		for d := 0; d <= weight; d++ {
			if d == 0 {
				sb.WriteString(strconv.Itoa(digit(d)))
			} else {
				fmt.Fprintf(&sb, "%04d", digit(d))
			}
		}
	}
	if dscale > 0 {
		var frac strings.Builder
		for d := weight + 1; frac.Len() < dscale; d++ {
			fmt.Fprintf(&frac, "%04d", digit(d))
		}
		sb.WriteByte('.')
		sb.WriteString(frac.String()[:dscale])
	}
	return sb.String(), true
}
