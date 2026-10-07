package resort

import (
	"bytes"
	"context"
	"encoding/json"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
)

// Row is one result row as node-postgres hands it to JSON.stringify:
// columns in SELECT order (a repeated name keeps its first position and
// the last value, as `r.*, r.check_in::text AS check_in` does), numeric
// and bigint as strings, int4 and float8 as numbers, timestamptz as JS
// Dates, json passed through.
type Row struct {
	keys []string
	vals map[string]any
}

func newRow() *Row { return &Row{vals: map[string]any{}} }

// Set adds or replaces a key, keeping its first position.
func (r *Row) Set(key string, v any) *Row {
	if _, ok := r.vals[key]; !ok {
		r.keys = append(r.keys, key)
	}
	r.vals[key] = v
	return r
}

// Str is a text column ("" when NULL).
func (r *Row) Str(key string) string {
	s, _ := r.vals[key].(string)
	return s
}

// MarshalJSON writes the keys in order, without HTML escaping.
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
		var vb bytes.Buffer
		enc := json.NewEncoder(&vb)
		enc.SetEscapeHTML(false)
		if err := enc.Encode(r.vals[k]); err != nil {
			return nil, err
		}
		buf.Write(bytes.TrimRight(vb.Bytes(), "\n"))
	}
	buf.WriteByte('}')
	return buf.Bytes(), nil
}

// textResults asks PostgreSQL for every column in text format, the format
// node-postgres reads, so values convert exactly as pg-types converts them.
var textResults = pgx.QueryResultFormats{pgx.TextFormatCode}

// queryRows runs sql and returns node-postgres shaped rows.
func queryRows(ctx context.Context, q database.Querier, sql string, args ...any) ([]*Row, error) {
	rows, err := q.Query(ctx, sql, append([]any{textResults}, args...)...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	fields := rows.FieldDescriptions()
	out := []*Row{}
	for rows.Next() {
		raw := rows.RawValues()
		row := newRow()
		for i, fd := range fields {
			v, err := nodeValue(fd.DataTypeOID, raw[i])
			if err != nil {
				return nil, err
			}
			row.Set(fd.Name, v)
		}
		out = append(out, row)
	}
	return out, rows.Err()
}

// queryRow returns the first row, or nil when there is none.
func queryRow(ctx context.Context, q database.Querier, sql string, args ...any) (*Row, error) {
	rows, err := queryRows(ctx, q, sql, args...)
	if err != nil || len(rows) == 0 {
		return nil, err
	}
	return rows[0], nil
}

// PostgreSQL type OIDs the resort queries return.
const (
	oidBool        = 16
	oidInt2        = 21
	oidInt4        = 23
	oidJSON        = 114
	oidFloat4      = 700
	oidFloat8      = 701
	oidTextArray   = 1009
	oidVarcharArr  = 1015
	oidTimestamptz = 1184
	oidJSONB       = 3802
)

// nodeValue converts one text-format value the way pg-types does.
func nodeValue(oid uint32, raw []byte) (any, error) {
	if raw == nil {
		return nil, nil
	}
	s := string(raw)
	switch oid {
	case oidBool:
		return s == "t", nil
	case oidInt2, oidInt4:
		return strconv.ParseInt(s, 10, 64)
	case oidFloat4, oidFloat8:
		return strconv.ParseFloat(s, 64)
	case oidJSON, oidJSONB:
		return json.RawMessage(append([]byte(nil), raw...)), nil
	case oidTimestamptz:
		t, err := parseTimestamptz(s)
		if err != nil {
			return nil, err
		}
		return httpx.JSTime(t), nil
	case oidTextArray, oidVarcharArr:
		return parseTextArray(s), nil
	}
	// text, varchar, uuid, numeric and int8 stay strings; every date the
	// resort queries return is cast to text.
	return s, nil
}

// parseTimestamptz reads the ISO DateStyle output, e.g.
// "2026-10-04 15:00:00.123456+07".
func parseTimestamptz(s string) (time.Time, error) {
	var err error
	for _, layout := range []string{"2006-01-02 15:04:05.999999999-07", "2006-01-02 15:04:05.999999999-07:00", "2006-01-02 15:04:05.999999999-07:00:00"} {
		var t time.Time
		if t, err = time.Parse(layout, s); err == nil {
			return t, nil
		}
	}
	return time.Time{}, err
}

// parseTextArray reads a one-dimensional text[] literal such as
// {wifi,"air panas",NULL}.
func parseTextArray(s string) []any {
	out := []any{}
	s = strings.TrimSuffix(strings.TrimPrefix(s, "{"), "}")
	if s == "" {
		return out
	}
	var cur strings.Builder
	quoted, wasQuoted, escaped := false, false, false
	flush := func() {
		if v := cur.String(); !wasQuoted && v == "NULL" {
			out = append(out, nil)
		} else {
			out = append(out, v)
		}
		cur.Reset()
		wasQuoted = false
	}
	for _, c := range s {
		switch {
		case escaped:
			cur.WriteRune(c)
			escaped = false
		case c == '\\':
			escaped = true
		case c == '"':
			quoted = !quoted
			wasQuoted = true
		case c == ',' && !quoted:
			flush()
		default:
			cur.WriteRune(c)
		}
	}
	flush()
	return out
}
