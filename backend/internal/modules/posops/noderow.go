package posops

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"nuhabit/backend/internal/modules/posops/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
)

// Most POS routes return database rows as-is through node-postgres and
// JSON.stringify, so the JSON contract follows the SQL: columns in SELECT
// order, numeric and bigint as strings, int4 and float as numbers,
// timestamptz and date as toISOString, json columns re-serialized by
// JSON.parse. Obj and collect reproduce that.

// Obj is a JSON object that keeps JS insertion order: setting an existing
// key replaces the value in place, like a spread or an assignment.
type Obj struct {
	keys []string
	vals map[string]any
}

// NewObj builds an object from key, value pairs.
func NewObj(kv ...any) *Obj {
	o := &Obj{vals: make(map[string]any, len(kv)/2)}
	for i := 0; i+1 < len(kv); i += 2 {
		o.Set(kv[i].(string), kv[i+1])
	}
	return o
}

// Set adds or replaces key.
func (o *Obj) Set(key string, v any) *Obj {
	if _, ok := o.vals[key]; !ok {
		o.keys = append(o.keys, key)
	}
	o.vals[key] = v
	return o
}

// Get returns the value (nil when absent).
func (o *Obj) Get(key string) any { return o.vals[key] }

// Str returns a string value, "" otherwise.
func (o *Obj) Str(key string) string {
	s, _ := o.vals[key].(string)
	return s
}

// StrPtr returns a string value or nil.
func (o *Obj) StrPtr(key string) *string {
	if s, ok := o.vals[key].(string); ok {
		return &s
	}
	return nil
}

// Clone copies the top level ({ ...row }).
func (o *Obj) Clone() *Obj {
	c := &Obj{keys: append([]string(nil), o.keys...), vals: make(map[string]any, len(o.vals))}
	for k, v := range o.vals {
		c.vals[k] = v
	}
	return c
}

// MarshalJSON writes the keys in order without HTML escaping.
func (o *Obj) MarshalJSON() ([]byte, error) {
	if o == nil {
		return []byte("null"), nil
	}
	var buf bytes.Buffer
	buf.WriteByte('{')
	for i, k := range o.keys {
		if i > 0 {
			buf.WriteByte(',')
		}
		kb, _ := marshalJS(k)
		buf.Write(kb)
		buf.WriteByte(':')
		vb, err := marshalJS(o.vals[k])
		if err != nil {
			return nil, err
		}
		buf.Write(vb)
	}
	buf.WriteByte('}')
	return buf.Bytes(), nil
}

func marshalJS(v any) ([]byte, error) {
	if f, ok := v.(float64); ok && (math.IsNaN(f) || math.IsInf(f, 0)) {
		return []byte("null"), nil // JSON.stringify(NaN)
	}
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(v); err != nil {
		return nil, err
	}
	return bytes.TrimRight(buf.Bytes(), "\n"), nil
}

/* ── node-postgres value conversion ──────────────────────────────────── */

const (
	oidJSON         = 114
	oidJSONB        = 3802
	oidNumeric      = 1700
	oidNumericArray = 1231
	oidInt8         = 20
	oidFloat4       = 700
	oidTime         = 1083
)

// collect reads every row as an Obj.
func collect(rows pgx.Rows) ([]*Obj, error) {
	defer rows.Close()
	fields := rows.FieldDescriptions()
	out := []*Obj{}
	for rows.Next() {
		vals, err := rows.Values()
		if err != nil {
			return nil, err
		}
		raw := rows.RawValues()
		o := &Obj{vals: make(map[string]any, len(fields))}
		for i, f := range fields {
			v, err := nodeValue(f.DataTypeOID, f.Format, raw[i], vals[i])
			if err != nil {
				return nil, fmt.Errorf("column %s: %w", f.Name, err)
			}
			o.Set(f.Name, v)
		}
		out = append(out, o)
	}
	return out, rows.Err()
}

// QueryObjs runs sql and returns its rows serialized like node-postgres.
func QueryObjs(ctx context.Context, q database.Querier, sql string, args ...any) ([]*Obj, error) {
	rows, err := q.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	return collect(rows)
}

// QueryObj returns the first row of QueryObjs, or nil when there is none.
func QueryObj(ctx context.Context, q database.Querier, sql string, args ...any) (*Obj, error) {
	list, err := QueryObjs(ctx, q, sql, args...)
	if err != nil || len(list) == 0 {
		return nil, err
	}
	return list[0], nil
}

func nodeValue(oid uint32, format int16, raw []byte, v any) (any, error) {
	if raw == nil {
		return nil, nil
	}
	switch oid {
	case oidJSON, oidJSONB:
		if oid == oidJSONB && format == pgtype.BinaryFormatCode && len(raw) > 0 {
			raw = raw[1:]
		}
		return jsJSON(raw)
	case oidNumeric:
		if format == pgtype.TextFormatCode {
			return string(raw), nil
		}
		return numericText(raw)
	case oidInt8:
		return fmt.Sprint(v), nil
	case oidFloat4:
		if f, ok := v.(float32); ok {
			x, _ := strconv.ParseFloat(strconv.FormatFloat(float64(f), 'g', -1, 32), 64)
			return x, nil
		}
	case oidNumericArray:
		// pg-types parses numeric[] with parseFloat.
		if list, ok := v.([]any); ok {
			out := make([]any, len(list))
			for i, e := range list {
				if n, ok := e.(pgtype.Numeric); ok && n.Valid {
					f, _ := n.Float64Value()
					out[i] = f.Float64
				}
			}
			return out, nil
		}
	case oidTime:
		if t, ok := v.(pgtype.Time); ok {
			return timeText(t.Microseconds), nil
		}
	}
	return plainValue(v), nil
}

func plainValue(v any) any {
	switch x := v.(type) {
	case time.Time:
		return httpx.JSTime(x)
	case [16]byte:
		return fmt.Sprintf("%x-%x-%x-%x-%x", x[0:4], x[4:6], x[6:8], x[8:10], x[10:16])
	case int64:
		return fmt.Sprint(x)
	case []any:
		out := make([]any, len(x))
		for i, e := range x {
			out[i] = plainValue(e)
		}
		return out
	case pgtype.Numeric:
		if !x.Valid {
			return nil
		}
		f, _ := x.Float64Value()
		return f.Float64
	}
	return v
}

// numericText renders a binary numeric the way numeric_out does, keeping
// the column scale ("0.00", "15000.00").
func numericText(raw []byte) (string, error) {
	if len(raw) < 8 {
		return "", fmt.Errorf("numeric: short value")
	}
	ndigits := int(int16(binary.BigEndian.Uint16(raw[0:2])))
	weight := int(int16(binary.BigEndian.Uint16(raw[2:4])))
	sign := binary.BigEndian.Uint16(raw[4:6])
	dscale := int(binary.BigEndian.Uint16(raw[6:8]))
	if len(raw) < 8+2*ndigits {
		return "", fmt.Errorf("numeric: short digits")
	}
	switch sign {
	case 0xC000:
		return "NaN", nil
	case 0xD000:
		return "Infinity", nil
	case 0xF000:
		return "-Infinity", nil
	}
	digit := func(i int) int {
		if i < 0 || i >= ndigits {
			return 0
		}
		return int(binary.BigEndian.Uint16(raw[8+2*i:]))
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
		for i := weight + 1; frac.Len() < dscale; i++ {
			fmt.Fprintf(&frac, "%04d", digit(i))
		}
		sb.WriteByte('.')
		sb.WriteString(frac.String()[:dscale])
	}
	return sb.String(), nil
}

// timeText is the text form of a time column ("10:00:00", "10:00:00.5").
func timeText(us int64) string {
	h, us := us/3_600_000_000, us%3_600_000_000
	m, us := us/60_000_000, us%60_000_000
	s, us := us/1_000_000, us%1_000_000
	out := fmt.Sprintf("%02d:%02d:%02d", h, m, s)
	if us > 0 {
		out += strings.TrimRight(fmt.Sprintf(".%06d", us), "0")
	}
	return out
}

/* ── JSON.parse → JSON.stringify ─────────────────────────────────────── */

// jsJSON re-serializes JSON text as JSON.stringify(JSON.parse(text)) does:
// compact, numbers as JS doubles, integer-like keys first, last duplicate
// key wins in the first key's position.
func jsJSON(raw []byte) (json.RawMessage, error) {
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	var buf bytes.Buffer
	if err := writeJSValue(dec, &buf); err != nil {
		return nil, err
	}
	return json.RawMessage(buf.Bytes()), nil
}

func writeJSValue(dec *json.Decoder, buf *bytes.Buffer) error {
	tok, err := dec.Token()
	if err != nil {
		return err
	}
	return writeJSToken(dec, buf, tok)
}

func writeJSToken(dec *json.Decoder, buf *bytes.Buffer, tok json.Token) error {
	switch t := tok.(type) {
	case json.Delim:
		if t == '[' {
			buf.WriteByte('[')
			for i := 0; dec.More(); i++ {
				if i > 0 {
					buf.WriteByte(',')
				}
				if err := writeJSValue(dec, buf); err != nil {
					return err
				}
			}
			_, err := dec.Token()
			buf.WriteByte(']')
			return err
		}
		return writeJSObject(dec, buf)
	case json.Number:
		f, err := strconv.ParseFloat(string(t), 64)
		if err != nil && !math.IsInf(f, 0) {
			return err
		}
		b, _ := marshalJS(f)
		buf.Write(b)
		return nil
	default:
		b, err := marshalJS(t)
		if err != nil {
			return err
		}
		buf.Write(b)
		return nil
	}
}

func writeJSObject(dec *json.Decoder, buf *bytes.Buffer) error {
	var keys []string
	vals := map[string][]byte{}
	for dec.More() {
		kt, err := dec.Token()
		if err != nil {
			return err
		}
		key, _ := kt.(string)
		var vb bytes.Buffer
		if err := writeJSValue(dec, &vb); err != nil {
			return err
		}
		if _, dup := vals[key]; !dup {
			keys = append(keys, key)
		}
		vals[key] = vb.Bytes()
	}
	if _, err := dec.Token(); err != nil {
		return err
	}
	keys = jsKeyOrder(keys)
	buf.WriteByte('{')
	for i, k := range keys {
		if i > 0 {
			buf.WriteByte(',')
		}
		kb, _ := marshalJS(k)
		buf.Write(kb)
		buf.WriteByte(':')
		buf.Write(vals[k])
	}
	buf.WriteByte('}')
	return nil
}

// jsKeyOrder moves array-index keys ("0", "12") first in ascending order,
// as JS objects enumerate them.
func jsKeyOrder(keys []string) []string {
	var idx, rest []string
	for _, k := range keys {
		if isArrayIndex(k) {
			idx = append(idx, k)
		} else {
			rest = append(rest, k)
		}
	}
	if len(idx) == 0 {
		return keys
	}
	sort.Slice(idx, func(i, j int) bool {
		a, _ := strconv.ParseUint(idx[i], 10, 64)
		b, _ := strconv.ParseUint(idx[j], 10, 64)
		return a < b
	})
	return append(idx, rest...)
}

func isArrayIndex(k string) bool {
	if k == "" || (len(k) > 1 && k[0] == '0') {
		return false
	}
	n, err := strconv.ParseUint(k, 10, 64)
	return err == nil && n < math.MaxUint32
}

// nodeParam converts a decoded JSON value the way node-postgres prepares a
// query parameter: numbers and booleans as their String(), objects as
// JSON text, undefined as NULL. Pair it with a ::text cast in SQL so
// PostgreSQL parses the text and raises its own error for bad input.
func nodeParam(v any) any {
	switch x := v.(type) {
	case nil, domain.Undefined:
		return nil
	case string:
		return x
	case time.Time:
		return x.Format(time.RFC3339Nano)
	case json.Number, bool, float64:
		return domain.String(x)
	case []string:
		list := make([]any, len(x))
		for i, e := range x {
			list[i] = e
		}
		return nodeParam(list)
	case []any:
		parts := make([]string, len(x))
		for i, e := range x {
			if domain.IsNullish(e) {
				parts[i] = "NULL"
				continue
			}
			s := domain.String(e)
			if _, isObj := e.(map[string]any); isObj {
				b, _ := json.Marshal(e)
				s = string(b)
			}
			parts[i] = `"` + strings.NewReplacer(`\`, `\\`, `"`, `\"`).Replace(s) + `"`
		}
		return "{" + strings.Join(parts, ",") + "}"
	}
	b, _ := json.Marshal(v)
	return string(b)
}

// jsTimePtr is a nullable timestamp as node-postgres renders it.
func jsTimePtr(t *time.Time) *httpx.JSTime { return httpx.NewJSTime(t) }
