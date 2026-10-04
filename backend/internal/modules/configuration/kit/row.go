// Package kit holds what every configuration sub-package (and the
// internal/app adapters that serve them) shares:
// node-postgres row rendering, configuration.app_settings access, request
// body reading with the TS semantics, and zod checks the platform lacks.
package kit

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"math"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
)

// Row is one result row rendered the way node-postgres hands it to
// NextResponse.json: columns in SELECT order, each value parsed from the
// text protocol by type OID as pg-types does. int2/int4 and floats are
// numbers, int8 and numeric stay strings, date and timestamp columns become
// JS Dates, json columns are re-serialized like JSON.parse + JSON.stringify,
// arrays become JS arrays. Routes that return `SELECT *` (or a query-builder
// select with embeds) return Rows, so the JSON contract follows the SQL.
type Row struct {
	keys []string
	vals map[string]any
}

// Obj builds an ordered JSON object from key, value pairs (a JS literal).
func Obj(kv ...any) *Row {
	r := &Row{vals: map[string]any{}}
	for i := 0; i+1 < len(kv); i += 2 {
		r.Set(kv[i].(string), kv[i+1])
	}
	return r
}

// Set adds or replaces a key, keeping first-insertion order like a JS spread.
func (r *Row) Set(key string, v any) {
	if _, ok := r.vals[key]; !ok {
		r.keys = append(r.keys, key)
	}
	r.vals[key] = v
}

// Get returns a value (nil when absent or NULL).
func (r *Row) Get(key string) any { return r.vals[key] }

// Str returns a text column, "" when NULL.
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

// Bool returns a boolean column, false when NULL.
func (r *Row) Bool(key string) bool {
	b, _ := r.vals[key].(bool)
	return b
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

/* ── Queries ─────────────────────────────────────────────────────────── */

// textResults asks PostgreSQL for every result column in text format, the
// form pg-types parses.
var textResults = pgx.QueryResultFormats{pgx.TextFormatCode}

// Query runs sql and returns node-postgres shaped rows (never nil).
func Query(ctx context.Context, q database.Querier, sql string, args ...any) ([]*Row, error) {
	rows, err := q.Query(ctx, sql, append([]any{textResults}, args...)...)
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
			v, err := parseText(f.DataTypeOID, raw[i])
			if err != nil {
				return nil, err
			}
			row.Set(f.Name, v)
		}
		out = append(out, row)
	}
	return out, rows.Err()
}

// QueryOne returns the first row, or nil when there is none (queryOne).
func QueryOne(ctx context.Context, q database.Querier, sql string, args ...any) (*Row, error) {
	rows, err := Query(ctx, q, sql, args...)
	if err != nil || len(rows) == 0 {
		return nil, err
	}
	return rows[0], nil
}

/* ── pg-types text parsers ───────────────────────────────────────────── */

const (
	oidBool        = 16
	oidInt8        = 20
	oidInt2        = 21
	oidInt4        = 23
	oidOID         = 26
	oidJSON        = 114
	oidFloat4      = 700
	oidFloat8      = 701
	oidBoolArr     = 1000
	oidInt2Arr     = 1005
	oidInt4Arr     = 1007
	oidTextArr     = 1009
	oidBpcharArr   = 1014
	oidVarcharArr  = 1015
	oidInt8Arr     = 1016
	oidFloat4Arr   = 1021
	oidFloat8Arr   = 1022
	oidDate        = 1082
	oidTimestamp   = 1114
	oidTimestampTZ = 1184
	oidNumericArr  = 1231
	oidUUIDArr     = 2951
	oidJSONB       = 3802
	oidJSONArr     = 199
	oidJSONBArr    = 3807
)

func parseText(oid uint32, raw []byte) (any, error) {
	if raw == nil {
		return nil, nil
	}
	s := string(raw)
	switch oid {
	case oidBool:
		return s == "t" || s == "true", nil
	case oidInt2, oidInt4, oidOID:
		return strconv.ParseInt(s, 10, 64)
	case oidFloat4, oidFloat8:
		f, err := strconv.ParseFloat(s, 64)
		if err != nil || math.IsNaN(f) || math.IsInf(f, 0) {
			return nil, nil // NaN/Infinity stringify as null
		}
		return f, nil
	case oidDate, oidTimestamp, oidTimestampTZ:
		t, ok := parsePgTime(s)
		if !ok {
			return nil, nil
		}
		return httpx.JSTime(t), nil
	case oidJSON, oidJSONB:
		return NormalizeJSON(raw)
	case oidBoolArr, oidInt2Arr, oidInt4Arr, oidTextArr, oidBpcharArr, oidVarcharArr,
		oidInt8Arr, oidFloat4Arr, oidFloat8Arr, oidNumericArr, oidUUIDArr, oidJSONArr, oidJSONBArr:
		return parseArray(oid, s)
	}
	// int8, numeric, text, varchar, uuid, enums, time, …: the raw string.
	return s, nil
}

// parsePgTime reads date, timestamp and timestamptz text. A value without an
// offset is local time; the API runs in UTC like the Next server, so a date
// is midnight UTC. Fractions are truncated to milliseconds like a JS Date.
func parsePgTime(s string) (time.Time, bool) {
	if s == "infinity" || s == "-infinity" {
		return time.Time{}, false
	}
	for _, layout := range []string{
		"2006-01-02 15:04:05.999999999-07:00:00",
		"2006-01-02 15:04:05.999999999-07:00",
		"2006-01-02 15:04:05.999999999-07",
		"2006-01-02 15:04:05.999999999",
		"2006-01-02",
	} {
		if t, err := time.Parse(layout, s); err == nil {
			return t.Truncate(time.Millisecond), true
		}
	}
	return time.Time{}, false
}

func parseArray(oid uint32, s string) (any, error) {
	items, err := parseArrayLiteral(s)
	if err != nil {
		return nil, err
	}
	out := make([]any, len(items))
	for i, it := range items {
		if it == nil {
			continue
		}
		v := *it
		switch oid {
		case oidBoolArr:
			out[i] = v == "t" || v == "true"
		case oidInt2Arr, oidInt4Arr:
			n, err := strconv.ParseInt(v, 10, 64)
			if err != nil {
				return nil, err
			}
			out[i] = n
		case oidFloat4Arr, oidFloat8Arr:
			f, _ := strconv.ParseFloat(v, 64)
			out[i] = f
		case oidJSONArr, oidJSONBArr:
			j, err := NormalizeJSON([]byte(v))
			if err != nil {
				return nil, err
			}
			out[i] = j
		default:
			out[i] = v
		}
	}
	return out, nil
}

// parseArrayLiteral splits a one-dimensional PostgreSQL array literal
// ("{a,\"b c\",NULL}"); nil entries are NULL.
func parseArrayLiteral(s string) ([]*string, error) {
	if len(s) < 2 || s[0] != '{' || s[len(s)-1] != '}' {
		return nil, errBadArray
	}
	body := s[1 : len(s)-1]
	out := []*string{}
	if body == "" {
		return out, nil
	}
	var cur strings.Builder
	quoted, inQuotes, escape := false, false, false
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
	for _, r := range body {
		switch {
		case escape:
			cur.WriteRune(r)
			escape = false
		case r == '\\':
			escape = true
		case r == '"':
			inQuotes = !inQuotes
			quoted = true
		case r == ',' && !inQuotes:
			flush()
		default:
			cur.WriteRune(r)
		}
	}
	flush()
	return out, nil
}

var errBadArray = errors.New("configuration: malformed array literal")

/* ── JSON normalization (JSON.parse then JSON.stringify) ──────────────── */

// NormalizeJSON re-serializes raw JSON the way JSON.stringify(JSON.parse(x))
// would: no insignificant whitespace, numbers in JS form, strings without
// HTML escaping, object keys in source order.
func NormalizeJSON(raw []byte) (json.RawMessage, error) {
	v, err := DecodeJSON(raw)
	if err != nil {
		return nil, err
	}
	out, err := Marshal(v)
	if err != nil {
		return nil, err
	}
	return json.RawMessage(out), nil
}

// DecodeJSON parses raw JSON into ordered values: *Row for objects, []any for
// arrays, float64 numbers, strings, bools and nil.
func DecodeJSON(raw []byte) (any, error) {
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	return decodeOrdered(dec)
}

// decodeOrdered reads one JSON value, objects as ordered Rows and numbers as
// float64 (JS numbers).
func decodeOrdered(dec *json.Decoder) (any, error) {
	tok, err := dec.Token()
	if err != nil {
		return nil, err
	}
	switch t := tok.(type) {
	case json.Delim:
		switch t {
		case '{':
			row := Obj()
			for dec.More() {
				kt, err := dec.Token()
				if err != nil {
					return nil, err
				}
				val, err := decodeOrdered(dec)
				if err != nil {
					return nil, err
				}
				row.Set(kt.(string), val)
			}
			_, err := dec.Token()
			return row, err
		case '[':
			list := []any{}
			for dec.More() {
				val, err := decodeOrdered(dec)
				if err != nil {
					return nil, err
				}
				list = append(list, val)
			}
			_, err := dec.Token()
			return list, err
		}
	case json.Number:
		return t.Float64()
	}
	return tok, nil
}
