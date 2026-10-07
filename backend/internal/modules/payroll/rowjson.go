package payroll

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/platform/database"
)

// The TS routes in this module mostly return rows straight from the query
// builder (`select("*")`, embeds as row_to_json). obj and the scanner below
// reproduce what node-postgres + JSON.stringify make of them, so the JSON
// contract follows the SQL instead of hand-written structs.

// obj is an ordered JSON object. Set on an existing key keeps its position,
// as assigning to a JS object (or a duplicate column name in node-postgres) does.
type obj struct {
	keys []string
	vals map[string]any
}

func newObj() *obj { return &obj{vals: map[string]any{}} }

// object builds an obj from key, value pairs.
func object(kv ...any) *obj {
	o := newObj()
	for i := 0; i+1 < len(kv); i += 2 {
		o.Set(kv[i].(string), kv[i+1])
	}
	return o
}

func (o *obj) Set(key string, v any) *obj {
	if _, ok := o.vals[key]; !ok {
		o.keys = append(o.keys, key)
	}
	o.vals[key] = v
	return o
}

// Del removes a key.
func (o *obj) Del(key string) *obj {
	if _, ok := o.vals[key]; !ok {
		return o
	}
	delete(o.vals, key)
	for i, k := range o.keys {
		if k == key {
			o.keys = append(o.keys[:i], o.keys[i+1:]...)
			break
		}
	}
	return o
}

func (o *obj) Get(key string) any { return o.vals[key] }

// Str is a string column ("" when null or absent).
func (o *obj) Str(key string) string { s, _ := o.vals[key].(string); return s }

// StrPtr is a nullable string column.
func (o *obj) StrPtr(key string) *string {
	if s, ok := o.vals[key].(string); ok {
		return &s
	}
	return nil
}

// Int is an int4 column (0 when null).
func (o *obj) Int(key string) int {
	switch v := o.vals[key].(type) {
	case int64:
		return int(v)
	case float64:
		return int(v)
	}
	return 0
}

// IntPtr is a nullable int4 column.
func (o *obj) IntPtr(key string) *int {
	if o.vals[key] == nil {
		return nil
	}
	n := o.Int(key)
	return &n
}

// Row returns the columns as a domain-style map (key present = defined).
func (o *obj) Row() map[string]any {
	if o == nil {
		return nil
	}
	m := make(map[string]any, len(o.vals))
	for k, v := range o.vals {
		m[k] = v
	}
	return m
}

func (o *obj) MarshalJSON() ([]byte, error) {
	if o == nil {
		return []byte("null"), nil
	}
	var buf bytes.Buffer
	buf.WriteByte('{')
	for i, k := range o.keys {
		if i > 0 {
			buf.WriteByte(',')
		}
		kb, _ := marshal(k)
		buf.Write(kb)
		buf.WriteByte(':')
		vb, err := marshal(o.vals[k])
		if err != nil {
			return nil, err
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

// jsTime marshals like Date.prototype.toJSON.
type jsTime time.Time

func (t jsTime) MarshalJSON() ([]byte, error) {
	return []byte(`"` + time.Time(t).UTC().Format("2006-01-02T15:04:05.000Z") + `"`), nil
}

// PostgreSQL type OIDs the scanner converts.
const (
	oidBool        = 16
	oidInt8        = 20
	oidInt2        = 21
	oidInt4        = 23
	oidOID         = 26
	oidJSON        = 114
	oidFloat4      = 700
	oidFloat8      = 701
	oidInt2Array   = 1005
	oidInt4Array   = 1007
	oidTextArray   = 1009
	oidVarArray    = 1015
	oidInt8Array   = 1016
	oidDate        = 1082
	oidTimestamp   = 1114
	oidTimestamptz = 1184
	oidNumeric     = 1700
	oidUUIDArray   = 2951
	oidJSONB       = 3802
)

// textResults asks for every result column in text format: the same bytes
// node-postgres parses, so numerics keep their scale.
var textResults = pgx.QueryResultFormats{pgx.TextFormatCode}

// queryObjs runs sql and converts each row the way node-postgres does.
func queryObjs(ctx context.Context, q database.Querier, sql string, args ...any) ([]*obj, error) {
	rows, err := q.Query(ctx, sql, append([]any{textResults}, args...)...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	fields := rows.FieldDescriptions()
	out := []*obj{}
	for rows.Next() {
		raw := rows.RawValues()
		o := newObj()
		for i, f := range fields {
			v, err := nodeValue(f.DataTypeOID, raw[i])
			if err != nil {
				return nil, fmt.Errorf("column %s: %w", f.Name, err)
			}
			o.Set(f.Name, v)
		}
		out = append(out, o)
	}
	return out, rows.Err()
}

// queryObj returns the first row, or nil when there is none.
func queryObj(ctx context.Context, q database.Querier, sql string, args ...any) (*obj, error) {
	rows, err := queryObjs(ctx, q, sql, args...)
	if err != nil || len(rows) == 0 {
		return nil, err
	}
	return rows[0], nil
}

// nodeValue converts one text-format value like node-postgres' default
// type parsers: int8 and numeric stay strings, int4/float become numbers,
// date and timestamps become Dates, json is parsed.
func nodeValue(oid uint32, raw []byte) (any, error) {
	if raw == nil {
		return nil, nil
	}
	s := string(raw)
	switch oid {
	case oidBool:
		return s == "t", nil
	case oidInt2, oidInt4, oidOID:
		return strconv.ParseInt(s, 10, 64)
	case oidFloat4, oidFloat8:
		return strconv.ParseFloat(s, 64)
	case oidDate:
		// node-postgres builds local midnight; the server runs in UTC.
		t, err := time.Parse("2006-01-02", s)
		if err != nil {
			return s, nil
		}
		return jsTime(t), nil
	case oidTimestamp:
		t, err := time.Parse("2006-01-02 15:04:05.999999", s)
		if err != nil {
			return s, nil
		}
		return jsTime(t), nil
	case oidTimestamptz:
		return parseTimestamptz(s)
	case oidJSON, oidJSONB:
		return decodeJSON(raw)
	case oidInt2Array, oidInt4Array:
		items := parseArray(s)
		out := make([]any, len(items))
		for i, it := range items {
			if it != nil {
				n, err := strconv.ParseInt(*it, 10, 64)
				if err != nil {
					return nil, err
				}
				out[i] = n
			}
		}
		return out, nil
	case oidTextArray, oidVarArray, oidUUIDArray, oidInt8Array:
		items := parseArray(s)
		out := make([]any, len(items))
		for i, it := range items {
			if it != nil {
				out[i] = *it
			}
		}
		return out, nil
	}
	return s, nil
}

// parseTimestamptz parses the ISO DateStyle output ("2026-10-04 17:00:00.123456+07").
func parseTimestamptz(s string) (any, error) {
	for _, layout := range []string{"2006-01-02 15:04:05.999999-07", "2006-01-02 15:04:05.999999-07:00", "2006-01-02 15:04:05.999999-07:00:00"} {
		if t, err := time.Parse(layout, s); err == nil {
			return jsTime(t), nil
		}
	}
	return nil, fmt.Errorf("unparsable timestamptz %q", s)
}

// parseArray splits a one-dimensional array literal; nil items are NULL.
func parseArray(s string) []*string {
	s = strings.TrimSuffix(strings.TrimPrefix(s, "{"), "}")
	if s == "" {
		return []*string{}
	}
	var out []*string
	var cur strings.Builder
	quoted, inQuotes, escaped := false, false, false
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
	for _, c := range s {
		switch {
		case escaped:
			cur.WriteRune(c)
			escaped = false
		case c == '\\':
			escaped = true
		case c == '"':
			inQuotes = !inQuotes
			quoted = true
		case c == ',' && !inQuotes:
			flush()
		default:
			cur.WriteRune(c)
		}
	}
	flush()
	return out
}

// decodeJSON is JSON.parse into ordered objects: objects become *obj (key
// order kept, a repeated key keeps its first position), numbers float64.
func decodeJSON(raw []byte) (any, error) {
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	v, err := decodeValue(dec)
	if err != nil {
		return nil, err
	}
	if _, err := dec.Token(); !errors.Is(err, io.EOF) {
		return nil, errors.New("json: trailing data")
	}
	return v, nil
}

func decodeValue(dec *json.Decoder) (any, error) {
	tok, err := dec.Token()
	if err != nil {
		return nil, err
	}
	switch t := tok.(type) {
	case json.Delim:
		switch t {
		case '{':
			o := newObj()
			for dec.More() {
				kt, err := dec.Token()
				if err != nil {
					return nil, err
				}
				v, err := decodeValue(dec)
				if err != nil {
					return nil, err
				}
				o.Set(kt.(string), v)
			}
			_, err := dec.Token()
			return o, err
		case '[':
			arr := []any{}
			for dec.More() {
				v, err := decodeValue(dec)
				if err != nil {
					return nil, err
				}
				arr = append(arr, v)
			}
			_, err := dec.Token()
			return arr, err
		}
	case json.Number:
		return t.Float64()
	}
	return tok, nil
}

// opaque hides a database error's SQLSTATE: the TS throws
// `new Error(error.message)` from query-builder results, which apiHandler
// renders as a 500 even for constraint violations.
func opaque(err error) error {
	if err == nil {
		return nil
	}
	return errors.New(err.Error())
}
