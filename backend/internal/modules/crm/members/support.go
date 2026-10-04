package members

import (
	"context"
	"fmt"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/platform/database"
)

// quietly runs fn in a savepoint and drops its error, for the reads the TS
// shim ignored (`const { data } = await ...`): a failure leaves the caller's
// transaction usable.
func quietly(ctx context.Context, db database.DB, fn func(q database.Querier) error) {
	_ = database.WithTx(ctx, db, func(tx pgx.Tx) error { return fn(tx) })
}

// arrayIndex reports whether a JS engine orders key as an integer index.
func arrayIndex(key string) (uint64, bool) {
	if key == "" || (len(key) > 1 && key[0] == '0') {
		return 0, false
	}
	n, err := strconv.ParseUint(key, 10, 32)
	return n, err == nil && n < 1<<32-1
}

func quoteIdent(id string) string { return `"` + strings.ReplaceAll(id, `"`, `""`) + `"` }

// splitTopLevel splits on commas outside parentheses (query-builder.ts).
func splitTopLevel(s string) []string {
	var out []string
	depth := 0
	var cur strings.Builder
	for _, ch := range s {
		switch ch {
		case '(':
			depth++
		case ')':
			depth--
		}
		if ch == ',' && depth == 0 {
			out = append(out, strings.TrimSpace(cur.String()))
			cur.Reset()
			continue
		}
		cur.WriteRune(ch)
	}
	if last := strings.TrimSpace(cur.String()); last != "" {
		out = append(out, last)
	}
	return out
}

var orOps = map[string]string{"eq": "=", "neq": "<>", "gt": ">", "gte": ">=", "lt": "<", "lte": "<=", "like": "LIKE", "ilike": "ILIKE"}

// shimOr ports the query builder's or("col.op.value,...") clause, quirks
// included: a search term with a comma yields a bogus column and the query
// fails like it does in TS.
func shimOr(expr string, args *[]any) string {
	var parts []string
	for _, p := range splitTopLevel(expr) {
		seg := strings.Split(p, ".")
		col, op, val := seg[0], "", ""
		if len(seg) > 1 {
			op = seg[1]
		}
		if len(seg) > 2 {
			val = strings.Join(seg[2:], ".")
		}
		if op == "is" {
			if val == "not.null" {
				parts = append(parts, quoteIdent(col)+" IS NOT NULL")
			} else {
				parts = append(parts, quoteIdent(col)+" IS NULL")
			}
			continue
		}
		sqlOp, ok := orOps[op]
		if !ok {
			sqlOp = "="
		}
		*args = append(*args, strings.ReplaceAll(val, "*", "%"))
		parts = append(parts, fmt.Sprintf("%s %s $%d", quoteIdent(col), sqlOp, len(*args)))
	}
	if len(parts) == 0 {
		return ""
	}
	return "(" + strings.Join(parts, " OR ") + ")"
}
