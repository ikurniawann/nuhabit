// Package domain holds the pure sales-funnel rules ported from
// frontend/src/lib/sales-funnel: parameterised SQL fragments, phone and date
// rules, tasks and recurrence, stage moves, forecast, quotation totals and
// terms, billing, stock realisation, timeline merge and custom fields.
package domain

import (
	"math"
	"regexp"
	"strconv"
	"strings"
)

// uuidRe is UUID_RE in lib/sales-funnel/sql.ts (any hex UUID shape).
var uuidRe = regexp.MustCompile(`^(?i)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

// IsUUID is isUuid.
func IsUUID(s string) bool { return uuidRe.MatchString(s) }

// Where is createWhere: conditions with sequential $n placeholders.
type Where struct {
	Conditions []string
	Params     []any
	start      int
}

// NewWhere starts a condition list whose first placeholder is $start.
func NewWhere(initial []string, start int) *Where {
	return &Where{Conditions: append([]string(nil), initial...), start: start}
}

// Param registers a value and returns its placeholder.
func (w *Where) Param(v any) string {
	w.Params = append(w.Params, v)
	return "$" + strconv.Itoa(w.start+len(w.Params)-1)
}

// Add appends fragment with its first "?" replaced by v's placeholder.
func (w *Where) Add(fragment string, v any) {
	w.Conditions = append(w.Conditions, strings.Replace(fragment, "?", w.Param(v), 1))
}

// Push appends a fragment as is.
func (w *Where) Push(fragment string) { w.Conditions = append(w.Conditions, fragment) }

// SQL joins the conditions with " AND ".
func (w *Where) SQL() string { return strings.Join(w.Conditions, " AND ") }

// UpdateSet is createUpdateSet: a partial SET clause that always bumps
// updated_at.
type UpdateSet struct {
	sets   []string
	values []any
}

// NewUpdateSet starts with "updated_at = now()".
func NewUpdateSet() *UpdateSet { return &UpdateSet{sets: []string{"updated_at = now()"}} }

// Set adds column = $n (with an optional cast such as "::jsonb").
func (u *UpdateSet) Set(column string, v any, cast string) {
	u.values = append(u.values, v)
	u.sets = append(u.sets, column+" = $"+strconv.Itoa(len(u.values))+cast)
}

// Raw adds a fragment without a parameter.
func (u *UpdateSet) Raw(fragment string) { u.sets = append(u.sets, fragment) }

// Build returns the SET clause, the values with id appended last and id's
// placeholder; ok is false when no parameterised column was set (the TS
// answers 400 "Tidak ada field yang diubah").
func (u *UpdateSet) Build(id any) (sql string, values []any, idParam string, ok bool) {
	if len(u.values) == 0 {
		return "", nil, "", false
	}
	return strings.Join(u.sets, ", "), append(append([]any(nil), u.values...), id), "$" + strconv.Itoa(len(u.values)+1), true
}

// NoFieldsChanged is the 400 message of an empty PATCH.
const NoFieldsChanged = "Tidak ada field yang diubah"

// JSNumber is Number(s) for a query-string value: "" and whitespace are 0,
// hex/octal/binary prefixes and Infinity parse, anything else is NaN.
func JSNumber(s string) float64 {
	t := strings.TrimFunc(s, isJSSpace)
	if t == "" {
		return 0
	}
	switch t {
	case "Infinity", "+Infinity":
		return math.Inf(1)
	case "-Infinity":
		return math.Inf(-1)
	}
	if len(t) > 2 && t[0] == '0' {
		base := 0
		switch t[1] {
		case 'x', 'X':
			base = 16
		case 'o', 'O':
			base = 8
		case 'b', 'B':
			base = 2
		}
		if base != 0 {
			n, err := strconv.ParseUint(t[2:], base, 64)
			if err != nil {
				return math.NaN()
			}
			return float64(n)
		}
	}
	for _, c := range t {
		if !(c >= '0' && c <= '9' || c == '.' || c == 'e' || c == 'E' || c == '+' || c == '-') {
			return math.NaN()
		}
	}
	f, err := strconv.ParseFloat(t, 64)
	if err != nil {
		return math.NaN()
	}
	return f
}

// OrDefault is `Number(x) || def`: NaN and 0 fall back.
func OrDefault(f, def float64) float64 {
	if math.IsNaN(f) || f == 0 {
		return def
	}
	return f
}

// Pagination is parsePagination: page >= 1, limit 1..100 (default 20).
type Pagination struct {
	Page, Limit, Offset float64
}

// ParsePagination reads page and limit query values.
func ParsePagination(page, limit string) Pagination {
	p := math.Max(1, OrDefault(JSNumber(page), 1))
	l := math.Min(100, math.Max(1, OrDefault(JSNumber(limit), 20)))
	return Pagination{Page: p, Limit: l, Offset: (p - 1) * l}
}

// TotalPages is Math.ceil(total / limit).
func (p Pagination) TotalPages(total float64) float64 { return math.Ceil(total / p.Limit) }

// SQLNumber renders a JS number as a query parameter: integers as int64,
// fractions as their JS string so PostgreSQL rejects them for an integer
// column as it does for node-postgres' text parameter.
func SQLNumber(f float64) any {
	if f == math.Trunc(f) && math.Abs(f) < 1<<53 {
		return int64(f)
	}
	return strconv.FormatFloat(f, 'f', -1, 64)
}

var (
	nonSlug   = regexp.MustCompile(`[^a-z0-9]+`)
	slugEdges = regexp.MustCompile(`(^-|-$)`)
)

// Slugify is slugify: lower case, non-alphanumerics to "-", edges trimmed,
// cut to maxLength UTF-16 units (the result is ASCII).
func Slugify(value string, maxLength int) string {
	s := nonSlug.ReplaceAllString(strings.ToLower(value), "-")
	s = slugEdges.ReplaceAllString(s, "")
	if len(s) > maxLength {
		s = s[:maxLength]
	}
	return s
}

func isJSSpace(r rune) bool {
	switch r {
	case ' ', '\t', '\n', '\v', '\f', '\r', 0xA0, 0x1680, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF:
		return true
	}
	return r >= 0x2000 && r <= 0x200A
}

// JSTrim is String.prototype.trim.
func JSTrim(s string) string { return strings.TrimFunc(s, isJSSpace) }
