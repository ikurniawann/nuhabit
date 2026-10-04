package kit

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"nuhabit/backend/internal/platform/database"
)

// Col is one payload column for the query-builder ports below. The TS shim
// (lib/pg/query-builder.ts) sends payload keys in object order; JSON
// columns receive JSON text.
type Col struct {
	Name  string
	Value any
}

// JSONText encodes v for a json/jsonb column the way the shim does
// (JSON.stringify for objects and arrays, strings passed through as JSON text).
func JSONText(v any) any {
	switch x := v.(type) {
	case nil:
		return nil
	case string:
		return x
	case json.RawMessage:
		return string(x)
	}
	b, _ := MarshalNoEscape(v)
	// Request values decode with json.Number: store them as JSON.stringify
	// would (1.50 becomes 1.5).
	return string(JSJSON(b))
}

func quoteIdent(id string) string { return `"` + strings.ReplaceAll(id, `"`, `""`) + `"` }

// Insert runs the shim's insert(...).select().single(): INSERT … RETURNING *.
func Insert(ctx context.Context, q database.Querier, table string, cols []Col) (*Row, error) {
	return upsert(ctx, q, table, cols, "")
}

// Upsert runs the shim's upsert(payload, {onConflict}).select().single():
// INSERT … ON CONFLICT (conflict) DO UPDATE SET <every other payload column>
// RETURNING *.
func Upsert(ctx context.Context, q database.Querier, table, conflict string, cols []Col) (*Row, error) {
	return upsert(ctx, q, table, cols, conflict)
}

func upsert(ctx context.Context, q database.Querier, table string, cols []Col, conflict string) (*Row, error) {
	names := make([]string, len(cols))
	ph := make([]string, len(cols))
	args := make([]any, len(cols))
	for i, c := range cols {
		names[i] = quoteIdent(c.Name)
		ph[i] = fmt.Sprintf("$%d", i+1)
		args[i] = c.Value
	}
	sql := fmt.Sprintf("INSERT INTO %s (%s) VALUES (%s)", table, strings.Join(names, ", "), strings.Join(ph, ", "))
	if conflict != "" {
		keys := strings.Split(conflict, ",")
		var sets []string
		for _, c := range cols {
			skip := false
			for _, k := range keys {
				if strings.TrimSpace(k) == c.Name {
					skip = true
				}
			}
			if !skip {
				sets = append(sets, fmt.Sprintf("%s = EXCLUDED.%s", quoteIdent(c.Name), quoteIdent(c.Name)))
			}
		}
		quoted := make([]string, len(keys))
		for i, k := range keys {
			quoted[i] = quoteIdent(strings.TrimSpace(k))
		}
		sql += fmt.Sprintf(" ON CONFLICT (%s) DO UPDATE SET %s", strings.Join(quoted, ", "), strings.Join(sets, ", "))
	}
	return QueryOne(ctx, q, sql+" RETURNING *", args...)
}

// Update runs the shim's update(payload).eq(idCol, id).select().single():
// the updated row, or nil when none matched (the shim's PGRST116).
func Update(ctx context.Context, q database.Querier, table string, cols []Col, idCol string, id any) (*Row, error) {
	sets := make([]string, len(cols))
	args := make([]any, 0, len(cols)+1)
	for i, c := range cols {
		args = append(args, c.Value)
		sets[i] = fmt.Sprintf("%s = $%d", quoteIdent(c.Name), i+1)
	}
	args = append(args, id)
	sql := fmt.Sprintf("UPDATE %s SET %s WHERE %s = $%d RETURNING *", table, strings.Join(sets, ", "), quoteIdent(idCol), len(args))
	return QueryOne(ctx, q, sql, args...)
}
