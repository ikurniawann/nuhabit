package kit

import (
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"net/url"
	"regexp"
	"slices"
	"strconv"
	"strings"

	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/validate"
)

// Args collects positional SQL parameters (SqlParams in the TS libs).
type Args struct{ Values []any }

// Add appends v and returns its placeholder.
func (a *Args) Add(v any) string {
	a.Values = append(a.Values, v)
	return "$" + strconv.Itoa(len(a.Values))
}

// Or ports the query builder shim's `.or("a.ilike.%x%,b.eq.1")` exactly:
// the expression is split on top-level commas and each part on dots, so a
// search term containing a comma yields a bogus column and the query fails
// as it does in TS. '*' in values becomes '%'. prefix qualifies columns
// ("" or `alias.`).
func Or(a *Args, prefix, expr string) string {
	parts := splitTopLevel(expr)
	sqls := make([]string, 0, len(parts))
	for _, p := range parts {
		segs := strings.Split(p, ".")
		col := quoteIdent(segs[0])
		op := ""
		if len(segs) > 1 {
			op = segs[1]
		}
		val := ""
		if len(segs) > 2 {
			val = strings.Join(segs[2:], ".")
		}
		if op == "is" {
			if val == "not.null" {
				sqls = append(sqls, prefix+col+" IS NOT NULL")
			} else {
				sqls = append(sqls, prefix+col+" IS NULL")
			}
			continue
		}
		sqlOp, ok := orOps[op]
		if !ok {
			sqlOp = "="
		}
		sqls = append(sqls, prefix+col+" "+sqlOp+" "+a.Add(strings.ReplaceAll(val, "*", "%")))
	}
	if len(sqls) == 0 {
		return ""
	}
	return "(" + strings.Join(sqls, " OR ") + ")"
}

var orOps = map[string]string{"eq": "=", "neq": "<>", "gt": ">", "gte": ">=", "lt": "<", "lte": "<=", "like": "LIKE", "ilike": "ILIKE"}

func quoteIdent(id string) string { return `"` + strings.ReplaceAll(id, `"`, `""`) + `"` }

// splitTopLevel is the shim's splitTopLevel: commas outside parentheses,
// parts trimmed, a trailing empty part dropped.
func splitTopLevel(s string) []string {
	var out []string
	depth := 0
	cur := strings.Builder{}
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
	if t := strings.TrimSpace(cur.String()); t != "" {
		out = append(out, t)
	}
	return out
}

// Search is `.or("c1.ilike.%term%,c2.ilike.%term%")`.
func Search(a *Args, prefix, term string, cols ...string) string {
	parts := make([]string, len(cols))
	for i, c := range cols {
		parts[i] = c + ".ilike.%" + term + "%"
	}
	return Or(a, prefix, strings.Join(parts, ","))
}

/* ── query strings ───────────────────────────────────────────────────── */

// QueryForm validates a query string the way the TS routes run a zod schema
// over Object.fromEntries(searchParams): the last value of a repeated key
// wins, values listed in ignore are dropped first (parseSearchParams), and
// z.coerce.number() fields go through Number().
type QueryForm struct {
	*validate.Form
	raw map[string]any
}

// NewQueryForm builds the form; ignore lists values to drop.
func NewQueryForm(values url.Values, ignore ...string) *QueryForm {
	raw := map[string]any{}
	for k, vs := range values {
		if len(vs) == 0 {
			continue
		}
		v := vs[len(vs)-1]
		if slices.Contains(ignore, v) {
			continue
		}
		raw[k] = v
	}
	return &QueryForm{Form: validate.New(raw, true), raw: raw}
}

// Query reads r's query string (parseSearchParams default ignores "").
func FromRequest(r *http.Request, ignore ...string) *QueryForm {
	return NewQueryForm(r.URL.Query(), ignore...)
}

// Coerce is z.coerce.number() with opts; def is used when the key is absent
// (.default(def)); a nil def makes it optional.
func (f *QueryForm) Coerce(key string, def *float64, o validate.NumOpts) *float64 {
	v, ok := f.raw[key]
	if !ok {
		return def
	}
	n := JSNumber(v.(string))
	if math.IsNaN(n) {
		f.Fail(key, "invalid_type", "Invalid input: expected number, received NaN")
		return nil
	}
	if math.IsInf(n, 0) {
		f.Fail(key, "invalid_type", "Invalid input: expected number, received number")
		return nil
	}
	x, _ := f.CheckNumber(key, json.Number(JSNum(n)), o)
	return &x
}

// CoerceInt is Coerce returning an int (callers pass Integer when the
// schema has .int()).
func (f *QueryForm) CoerceInt(key string, def float64, o validate.NumOpts) int {
	x := f.Coerce(key, &def, o)
	if x == nil {
		return int(def)
	}
	return int(*x)
}

// NumCheck is z.number() with a refinement carrying a custom message
// (.positive("…"), .min(0, "…")): the refinement only runs on a number.
func NumCheck(f *validate.Form, key string, r validate.Rule, refine func(float64) (code, msg string, ok bool)) *float64 {
	v, _, done := f.Take(key, "number", r)
	if done {
		return nil
	}
	x, ok := f.CheckNumber(key, v, validate.NumOpts{})
	if !ok {
		return nil
	}
	if code, msg, good := refine(x); !good {
		f.Fail(key, code, msg)
	}
	return &x
}

// Enum is z.enum(options) the way zod v4 reports it: any value outside the
// options (missing, null, a number) is one invalid_value issue, message
// either zod's option list or the schema's custom message. Absent keys
// pass when the rule is optional or has a default (nil returned).
// platform/validate.Enum reports missing/null as invalid_type instead.
func Enum(f *validate.Form, key string, r validate.Rule, options []string, message string) *string {
	obj := f.Fields()
	if obj == nil {
		return nil
	}
	v, sent := obj[key]
	if !sent && (r.Optional || r.HasDefault) {
		return nil
	}
	if v == nil && sent && r.Nullable {
		return nil
	}
	if s, ok := v.(string); ok && slices.Contains(options, s) {
		return &s
	}
	if message == "" {
		_, message, _ = validate.EnumCheck(options)("")
	}
	f.Fail(key, "invalid_value", message)
	return nil
}

// Positive is .positive(msg).
func Positive(msg string) func(float64) (string, string, bool) {
	return func(x float64) (string, string, bool) { return "too_small", msg, x > 0 }
}

// Min is .min(n, msg).
func Min(n float64, msg string) func(float64) (string, string, bool) {
	return func(x float64) (string, string, bool) { return "too_small", msg, x >= n }
}

// Pattern is z.string().regex(re) with zod's message.
func Pattern(re *regexp.Regexp, display string) func(string) (string, string, bool) {
	return func(s string) (string, string, bool) {
		return "invalid_format", "Invalid string: must match pattern " + display, re.MatchString(s)
	}
}

// FlattenErr is parseSearchParams' failure: 400 message with
// error.flatten().fieldErrors as details.
func (f *QueryForm) FlattenErr(message string) error {
	if f.Valid() {
		return nil
	}
	return httpx.BadRequest(message, FieldErrors(f.Issues()))
}

// FirstIssueErr is parseBodyOrThrow's failure: the first issue's message
// with every issue as details.
func FirstIssueErr(f *validate.Form) error {
	if f.Valid() {
		return nil
	}
	issues := f.Issues()
	return httpx.BadRequest(issues[0].Message, issues)
}

// FieldErrors is zod's flatten().fieldErrors: messages grouped by the first
// path segment, keys in first-seen order.
func FieldErrors(issues []validate.Issue) *Row {
	out := NewRow()
	for _, is := range issues {
		if len(is.Path) == 0 {
			continue
		}
		key := fmt.Sprint(is.Path[0])
		list, _ := out.Get(key).([]string)
		out.Set(key, append(list, is.Message))
	}
	return out
}

/* ── responses ───────────────────────────────────────────────────────── */

// Pagination is { page, limit, total } with page and limit as the JS
// numbers the route computed.
type Pagination struct {
	Page  Float `json:"page"`
	Limit Float `json:"limit"`
	Total int   `json:"total"`
}

// Float is a JS number in JSON: NaN and Infinity render as null, like
// JSON.stringify.
type Float float64

// MarshalJSON implements json.Marshaler.
func (f Float) MarshalJSON() ([]byte, error) {
	v := float64(f)
	if math.IsNaN(v) || math.IsInf(v, 0) {
		return []byte("null"), nil
	}
	return []byte(JSNum(v)), nil
}

// NumberParam is Number(sp.get(key) || def).
func NumberParam(values url.Values, key string, def float64) float64 {
	if v := values.Get(key); v != "" {
		return JSNumber(v)
	}
	return def
}

// IntParam is parseInt(sp.get(key) || def, 10) (NaN when not a number).
func IntParam(values url.Values, key string, def string) float64 {
	v := values.Get(key)
	if v == "" {
		v = def
	}
	if n, ok := ParseInt(v); ok {
		return float64(n)
	}
	return math.NaN()
}

type paginated struct {
	Success    bool   `json:"success"`
	Data       any    `json:"data"`
	Message    string `json:"message,omitempty"`
	Pagination any    `json:"pagination"`
}

// Paginated is paginatedResponse(data, meta, message?).
func Paginated(w http.ResponseWriter, data any, meta any, message string) error {
	return httpx.JSON(w, http.StatusOK, paginated{Success: true, Data: data, Message: message, Pagination: meta})
}

// Data writes {"success":true,"data":data} with status 200.
func Data(w http.ResponseWriter, data any) error { return httpx.Data(w, http.StatusOK, data) }

// OK writes body with status 200.
func OK(w http.ResponseWriter, body any) error { return httpx.JSON(w, http.StatusOK, body) }
