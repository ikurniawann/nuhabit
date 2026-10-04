package hris

import (
	"context"
	"fmt"
	"strings"

	"nuhabit/backend/internal/platform/database"
)

// Dynamic INSERT/UPDATE for the routes that write a zod-parsed allowlist
// (the TS query builder inserts exactly the keys present, NULL included).
// Column names always come from code, never from the request.

type kv struct {
	col string
	val any
}

type fields []kv

func (f *fields) add(col string, val any) { *f = append(*f, kv{col, val}) }

// set adds or replaces a column, keeping its first position (JS spread).
func (f *fields) set(col string, val any) {
	for i := range *f {
		if (*f)[i].col == col {
			(*f)[i].val = val
			return
		}
	}
	f.add(col, val)
}

// insertRow runs INSERT … RETURNING returning and gives back the row.
func insertRow(ctx context.Context, q database.Querier, table string, f fields, returning string) (*Row, error) {
	cols := make([]string, len(f))
	marks := make([]string, len(f))
	args := make([]any, len(f))
	for i, c := range f {
		cols[i], marks[i], args[i] = c.col, fmt.Sprintf("$%d", i+1), c.val
	}
	sql := fmt.Sprintf(`INSERT INTO %s (%s) VALUES (%s) RETURNING %s`,
		table, strings.Join(cols, ", "), strings.Join(marks, ", "), returning)
	return queryRow(ctx, q, sql, args...)
}

// updateRows runs UPDATE table SET f WHERE every cond equals its value,
// RETURNING returning (all matched rows).
func updateRows(ctx context.Context, q database.Querier, table string, f fields, conds fields, returning string) ([]*Row, error) {
	set := make([]string, len(f))
	args := make([]any, 0, len(f)+len(conds))
	for i, c := range f {
		args = append(args, c.val)
		set[i] = fmt.Sprintf("%s = $%d", c.col, len(args))
	}
	where := make([]string, len(conds))
	for i, c := range conds {
		args = append(args, c.val)
		where[i] = fmt.Sprintf("%s = $%d", c.col, len(args))
	}
	sql := fmt.Sprintf(`UPDATE %s SET %s WHERE %s RETURNING %s`,
		table, strings.Join(set, ", "), strings.Join(where, " AND "), returning)
	return queryRows(ctx, q, sql, args...)
}

// updateOne is updateRows for `.update().eq(…).select().single()`: the first
// row, or errNoRow (which renders as a 500 like the shim's PGRST116).
func updateOne(ctx context.Context, q database.Querier, table string, f fields, conds fields, returning string) (*Row, error) {
	rows, err := updateRows(ctx, q, table, f, conds, returning)
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return nil, errNoRow
	}
	return rows[0], nil
}

// errNoRow is the query builder's PGRST116 ("No rows found") surfacing
// through unwrap: not an ApiError, so the route answers 500.
var errNoRow = noRowError{}

type noRowError struct{}

func (noRowError) Error() string { return "No rows found" }

// ignoreBadInput turns an invalid_text_representation error (a malformed
// uuid in the path) into "no row", for lookups whose error the TS ignores.
func ignoreBadInput(err error) error {
	if database.PgCode(err) == "22P02" {
		return nil
	}
	return err
}
