package kit

import (
	"context"
	"encoding/json"
	"strings"

	"nuhabit/backend/internal/platform/database"
)

// The query builder shim's writes (frontend/src/lib/pg/query-builder.ts):
// columns are the payload keys in order, numbers go as their JS text, and
// `.select()` / `.single()` mean RETURNING *.

// Param converts a payload value: float64 → N, nested objects → JSON text.
func Param(v any) any {
	switch x := v.(type) {
	case float64:
		return N(x)
	case *float64:
		if x == nil {
			return nil
		}
		return N(*x)
	case *Row, []any, map[string]any:
		b, _ := json.Marshal(x)
		return string(b)
	}
	return v
}

// Insert is `.insert(rows)[.select()]`, optionally `.upsert(rows, {onConflict})`
// (conflict = "a,b"). Columns are the union of the rows' keys; a row lacking
// a key sends NULL.
func Insert(ctx context.Context, q database.Querier, table string, rows []*Row, conflict string, returning bool) (Rows, error) {
	var cols []string
	seen := map[string]bool{}
	for _, r := range rows {
		for _, k := range r.Keys() {
			if !seen[k] {
				seen[k] = true
				cols = append(cols, k)
			}
		}
	}
	a := &Args{}
	quoted := make([]string, len(cols))
	for i, c := range cols {
		quoted[i] = quoteIdent(c)
	}
	values := make([]string, len(rows))
	for i, r := range rows {
		ph := make([]string, len(cols))
		for j, c := range cols {
			ph[j] = a.Add(Param(r.Get(c)))
		}
		values[i] = "(" + strings.Join(ph, ", ") + ")"
	}
	sql := "INSERT INTO " + table + " (" + strings.Join(quoted, ", ") + ") VALUES " + strings.Join(values, ", ")
	if conflict != "" {
		keys := strings.Split(conflict, ",")
		var updates, conflictCols []string
		for i := range keys {
			keys[i] = strings.TrimSpace(keys[i])
			conflictCols = append(conflictCols, quoteIdent(keys[i]))
		}
		for _, c := range cols {
			isKey := false
			for _, k := range keys {
				isKey = isKey || k == c
			}
			if !isKey {
				updates = append(updates, quoteIdent(c)+" = EXCLUDED."+quoteIdent(c))
			}
		}
		sql += " ON CONFLICT (" + strings.Join(conflictCols, ", ") + ") DO UPDATE SET " + strings.Join(updates, ", ")
	}
	if !returning {
		_, err := q.Exec(ctx, sql, a.Values...)
		return nil, err
	}
	return Query(ctx, q, sql+" RETURNING *", a.Values...)
}

// InsertOne is `.insert(row).select().single()`.
func InsertOne(ctx context.Context, q database.Querier, table string, row *Row) (*Row, error) {
	rows, err := Insert(ctx, q, table, []*Row{row}, "", true)
	if err != nil || len(rows) == 0 {
		return nil, err
	}
	return rows[0], nil
}

// Update is `.update(set)` with where built on the same Args, RETURNING *
// when returning.
func Update(ctx context.Context, q database.Querier, table string, set *Row, where func(a *Args) string, returning bool) (Rows, error) {
	a := &Args{}
	parts := make([]string, 0, len(set.Keys()))
	for _, k := range set.Keys() {
		parts = append(parts, quoteIdent(k)+" = "+a.Add(Param(set.Get(k))))
	}
	sql := "UPDATE " + table + " SET " + strings.Join(parts, ", ") + " WHERE " + where(a)
	if !returning {
		_, err := q.Exec(ctx, sql, a.Values...)
		return nil, err
	}
	return Query(ctx, q, sql+" RETURNING *", a.Values...)
}

// ParseJSON decodes JSON into ordered values: *Row for objects, []any,
// float64, string, bool, nil.
func ParseJSON(raw []byte) (any, error) {
	dec := json.NewDecoder(strings.NewReader(string(raw)))
	dec.UseNumber()
	return parseValue(dec)
}

func parseValue(dec *json.Decoder) (any, error) {
	tok, err := dec.Token()
	if err != nil {
		return nil, err
	}
	switch t := tok.(type) {
	case json.Delim:
		if t == '[' {
			out := []any{}
			for dec.More() {
				v, err := parseValue(dec)
				if err != nil {
					return nil, err
				}
				out = append(out, v)
			}
			_, err := dec.Token()
			return out, err
		}
		row := NewRow()
		for dec.More() {
			k, err := dec.Token()
			if err != nil {
				return nil, err
			}
			v, err := parseValue(dec)
			if err != nil {
				return nil, err
			}
			row.Set(k.(string), v)
		}
		_, err := dec.Token()
		return row, err
	case json.Number:
		return t.Float64()
	}
	return tok, nil
}

// Embed returns a json column as an ordered object (nil when NULL).
func Embed(v any) *Row {
	raw, ok := v.(json.RawMessage)
	if !ok {
		return nil
	}
	parsed, err := ParseJSON(raw)
	if err != nil {
		return nil
	}
	row, _ := parsed.(*Row)
	return row
}

// EmbedSQL is the shim's many-to-one embed `alias:table!fk(*)`:
// row_to_json of the target row whose targetCol equals outer.srcCol.
func EmbedSQL(alias, target, targetCol, outer, srcCol string) string {
	return `(SELECT row_to_json(e) FROM (SELECT * FROM ` + target + ` WHERE ` + quoteIdent(targetCol) + ` = ` +
		quoteIdent(outer) + `.` + quoteIdent(srcCol) + `) e) AS ` + quoteIdent(alias)
}

// EmbedColsSQL is EmbedSQL with an inner column list `alias:table!fk(a,b)`.
func EmbedColsSQL(alias, target, targetCol, outer, srcCol string, cols ...string) string {
	quoted := make([]string, len(cols))
	for i, c := range cols {
		quoted[i] = quoteIdent(c)
	}
	return `(SELECT row_to_json(e) FROM (SELECT ` + strings.Join(quoted, ", ") + ` FROM ` + target + ` WHERE ` +
		quoteIdent(targetCol) + ` = ` + quoteIdent(outer) + `.` + quoteIdent(srcCol) + `) e) AS ` + quoteIdent(alias)
}
