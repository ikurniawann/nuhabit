package procurement

import (
	"strconv"
	"strings"
)

// where collects AND-ed filters with numbered placeholders, the way the
// query builder appended .eq/.or/.ilike filters.
type where struct {
	clauses []string
	args    []any
}

func newWhere() *where { return &where{} }

// add appends a clause whose %s marks become the next placeholders.
func (w *where) add(clause string, args ...any) *where {
	for _, a := range args {
		w.args = append(w.args, a)
		clause = strings.Replace(clause, "%s", "$"+strconv.Itoa(len(w.args)), 1)
	}
	w.clauses = append(w.clauses, clause)
	return w
}

// sql renders "WHERE a AND b" (or "").
func (w *where) sql() string {
	if len(w.clauses) == 0 {
		return ""
	}
	return "WHERE " + strings.Join(w.clauses, " AND ")
}

// next is the placeholder after the collected args.
func (w *where) next(arg any) string {
	w.args = append(w.args, arg)
	return "$" + strconv.Itoa(len(w.args))
}

func itoa(i int) string { return strconv.Itoa(i) }
