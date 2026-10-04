package insights

import (
	"bytes"
	"context"
	"encoding/json"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/insights/domain"
	"nuhabit/backend/internal/platform/database"
)

// Rows the way node-postgres hands them to JSON.stringify: numeric and int8
// as strings, int4/float8 as numbers, bool as booleans, timestamps as
// Dates (date and timestamp read as WIB wall clock), json re-serialized
// compactly, everything else as PostgreSQL's text form. Used by the tool
// results and summary detail rows, whose shape is the SELECT list.

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
	oidJSONB       = 3802
)

var textResults = pgx.QueryResultFormats{pgx.TextFormatCode}

// queryObjects runs sql and returns every row as an ordered object.
func queryObjects(ctx context.Context, q database.Querier, sql string, args ...any) ([]domain.Object, error) {
	rows, err := q.Query(ctx, sql, append([]any{textResults}, args...)...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	fields := rows.FieldDescriptions()
	out := []domain.Object{}
	for rows.Next() {
		raw := rows.RawValues()
		var vals []any
		row := make(domain.Object, len(fields))
		for i, f := range fields {
			row[i].Key = f.Name
			if raw[i] == nil {
				continue
			}
			text := string(raw[i])
			switch f.DataTypeOID {
			case oidBool:
				row[i].Value = text == "t"
			case oidInt2, oidInt4, oidOID, oidFloat4, oidFloat8:
				n, _ := strconv.ParseFloat(text, 64)
				row[i].Value = n
			case oidJSON, oidJSONB:
				var buf bytes.Buffer
				if json.Compact(&buf, raw[i]) == nil {
					row[i].Value = json.RawMessage(buf.Bytes())
				}
			case oidDate, oidTimestamp, oidTimestamptz:
				if vals == nil {
					if vals, err = rows.Values(); err != nil {
						return nil, err
					}
				}
				t, ok := vals[i].(time.Time)
				if !ok {
					row[i].Value = text
					continue
				}
				if f.DataTypeOID != oidTimestamptz {
					t = time.Date(t.Year(), t.Month(), t.Day(), t.Hour(), t.Minute(), t.Second(), t.Nanosecond(), domain.WIB)
				}
				row[i].Value = domain.JSDate(t)
			default: // text, varchar, uuid, enums, int8, numeric
				row[i].Value = text
			}
		}
		out = append(out, row)
	}
	return out, rows.Err()
}
