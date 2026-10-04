package gymtraining

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"regexp"
	"slices"
	"strings"
	"time"
	"unicode"
	"unicode/utf16"

	"nuhabit/backend/internal/platform/httpx"
)

// Validation mirrors the zod schemas of the TS routes. Staff routes answer
// like parseInput in frontend/src/lib/gym/staff-route.ts: fields are checked
// in schema order and the first failing path names the 400
// ("Data tidak valid: default_spec.distanceM"); details carry zod-like issues
// that no client reads. Member routes only ask whether the body is valid.

type issue struct {
	Code    string `json:"code"`
	Path    []any  `json:"path"`
	Message string `json:"message"`
}

// uuidPattern is zod v4's z.string().uuid().
var uuidPattern = regexp.MustCompile(`^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$`)

func isUUID(s string) bool { return uuidPattern.MatchString(s) }

// datetimePattern is zod v4's z.string().datetime({ offset: true }).
var datetimePattern = regexp.MustCompile(`^(?:(?:\d\d[2468][048]|\d\d[13579][26]|\d\d0[48]|[02468][048]00|[13579][26]00)-02-29|\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\d|30)|(?:02)-(?:0[1-9]|1\d|2[0-8])))T(?:(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z|([+-](?:[01]\d|2[0-3]):[0-5]\d)))$`)

// parseJSDate parses what datetimePattern accepts, as new Date(...) does.
func parseJSDate(s string) (time.Time, bool) {
	for _, layout := range []string{time.RFC3339Nano, "2006-01-02T15:04Z07:00"} {
		if t, err := time.Parse(layout, s); err == nil {
			return t, true
		}
	}
	return time.Time{}, false
}

// readBody mirrors `await request.json().catch(() => undefined)`.
func readBody(r *http.Request) (any, bool) {
	if r.Body == nil {
		return nil, false
	}
	raw, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		return nil, false
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	var v any
	if err := dec.Decode(&v); err != nil {
		return nil, false
	}
	return v, true
}

// form validates one JSON object; nested objects share the issue list.
type form struct {
	obj    map[string]any
	path   []any
	issues *[]issue
}

func newForm(body any, present bool) *form {
	f := &form{path: []any{}, issues: &[]issue{}}
	f.obj = f.object(nil, body, present)
	return f
}

func (f *form) at(key any) []any {
	if key == nil {
		return slices.Clone(f.path)
	}
	return append(slices.Clone(f.path), key)
}

func (f *form) fail(key any, code, msg string) {
	*f.issues = append(*f.issues, issue{Code: code, Path: f.at(key), Message: msg})
}

func (f *form) object(key any, v any, present bool) map[string]any {
	obj, ok := v.(map[string]any)
	if !ok {
		f.fail(key, "invalid_type", "Invalid input: expected object, received "+typeName(v, present))
	}
	return obj
}

// child validates a nested required object.
func (f *form) child(key string) *form {
	v, sent := f.obj[key]
	c := &form{path: f.at(key), issues: f.issues}
	if f.obj != nil {
		c.obj = f.object(key, v, sent)
	}
	return c
}

func (f *form) valid() bool { return len(*f.issues) == 0 }

// err is the staff 400, or nil when every field passed.
func (f *form) err() error {
	if f.valid() {
		return nil
	}
	first := (*f.issues)[0]
	if len(first.Path) == 0 {
		return httpx.BadRequest("Data tidak valid", *f.issues)
	}
	parts := make([]string, len(first.Path))
	for i, p := range first.Path {
		parts[i] = fmt.Sprint(p)
	}
	return httpx.BadRequest("Data tidak valid: "+strings.Join(parts, "."), *f.issues)
}

func typeName(v any, present bool) string {
	if !present {
		return "undefined"
	}
	switch v.(type) {
	case nil:
		return "null"
	case string:
		return "string"
	case json.Number:
		return "number"
	case bool:
		return "boolean"
	case []any:
		return "array"
	}
	return "object"
}

// rule says how undefined and null are treated.
type rule struct {
	optional   bool // undefined allowed
	nullable   bool // null allowed
	hasDefault bool // undefined takes a default
}

// take returns the raw value, or done=true when the caller should use the
// zero value (absent, null, or already failed).
func (f *form) take(key, expected string, r rule) (v any, sent, done bool) {
	if f.obj == nil {
		return nil, false, true
	}
	v, sent = f.obj[key]
	switch {
	case !sent:
		if !r.optional && !r.hasDefault {
			f.fail(key, "invalid_type", "Invalid input: expected "+expected+", received undefined")
		}
		return nil, false, true
	case v == nil:
		if !r.nullable {
			f.fail(key, "invalid_type", "Invalid input: expected "+expected+", received null")
		}
		return nil, true, true
	}
	return v, true, false
}

/* ── strings ─────────────────────────────────────────────────────────── */

type strOpts struct {
	trim     bool
	min, max int
	check    func(string) (code, msg string, ok bool)
}

func utf16Len(s string) int { return len(utf16.Encode([]rune(s))) }

// jsTrim is String.prototype.trim: Unicode whitespace plus the BOM.
func jsTrim(s string) string {
	return strings.TrimFunc(s, func(r rune) bool { return unicode.IsSpace(r) || r == '\uFEFF' })
}

func (f *form) checkString(key any, v any, o strOpts) (string, bool) {
	s, ok := v.(string)
	if !ok {
		f.fail(key, "invalid_type", "Invalid input: expected string, received "+typeName(v, true))
		return "", false
	}
	if o.trim {
		s = jsTrim(s)
	}
	n := utf16Len(s)
	ok = true
	switch {
	case o.min > 0 && n < o.min:
		f.fail(key, "too_small", fmt.Sprintf("Too small: expected string to have >=%d characters", o.min))
		ok = false
	case o.max > 0 && n > o.max:
		f.fail(key, "too_big", fmt.Sprintf("Too big: expected string to have <=%d characters", o.max))
		ok = false
	}
	if o.check != nil {
		if code, msg, good := o.check(s); !good {
			f.fail(key, code, msg)
			ok = false
		}
	}
	return s, ok
}

// str returns nil when the key is absent or null (or invalid).
func (f *form) str(key string, r rule, o strOpts) *string {
	v, _, done := f.take(key, "string", r)
	if done {
		return nil
	}
	s, _ := f.checkString(key, v, o)
	return &s
}

// strDefault is z.string()….default(def).
func (f *form) strDefault(key, def string, o strOpts) string {
	if s := f.str(key, rule{hasDefault: true}, o); s != nil {
		return *s
	}
	return def
}

var uuidCheck = func(s string) (string, string, bool) { return "invalid_format", "Invalid UUID", isUUID(s) }

func (f *form) uuid(key string, r rule) *string { return f.str(key, r, strOpts{check: uuidCheck}) }

func enumCheck(options []string) func(string) (string, string, bool) {
	return func(s string) (string, string, bool) {
		quoted := make([]string, len(options))
		for i, o := range options {
			quoted[i] = `"` + o + `"`
		}
		return "invalid_value", "Invalid option: expected one of " + strings.Join(quoted, "|"), slices.Contains(options, s)
	}
}

func (f *form) enum(key string, r rule, options []string) *string {
	return f.str(key, r, strOpts{check: enumCheck(options)})
}

var datetimeCheck = func(s string) (string, string, bool) {
	return "invalid_format", "Invalid ISO datetime", datetimePattern.MatchString(s)
}

// validURL mirrors z.string().url(): new URL(s) must succeed, so a scheme is
// required and the special schemes need a host.
func validURL(s string) bool {
	u, err := url.Parse(s)
	if err != nil || u.Scheme == "" {
		return false
	}
	switch strings.ToLower(u.Scheme) {
	case "http", "https", "ftp", "ws", "wss":
		return u.Host != ""
	}
	return true
}

var urlCheck = func(s string) (string, string, bool) { return "invalid_format", "Invalid URL", validURL(s) }

/* ── numbers and booleans ────────────────────────────────────────────── */

type numOpts struct {
	integer  bool
	positive bool // > 0
	min, max *float64
}

func bound(v float64) *float64 { return &v }

func (f *form) checkNumber(key any, v any, o numOpts) (float64, bool) {
	num, ok := v.(json.Number)
	if !ok {
		f.fail(key, "invalid_type", "Invalid input: expected number, received "+typeName(v, true))
		return 0, false
	}
	x, err := num.Float64()
	if err != nil || math.IsInf(x, 0) {
		f.fail(key, "invalid_type", "Invalid input: expected number, received number")
		return 0, false
	}
	if o.integer && (x != math.Trunc(x) || math.Abs(x) > 1<<53-1) {
		f.fail(key, "invalid_type", "Invalid input: expected int, received number")
		return x, false
	}
	switch {
	case o.positive && x <= 0:
		f.fail(key, "too_small", "Too small: expected number to be >0")
		return x, false
	case o.min != nil && x < *o.min:
		f.fail(key, "too_small", fmt.Sprintf("Too small: expected number to be >=%v", *o.min))
		return x, false
	case o.max != nil && x > *o.max:
		f.fail(key, "too_big", fmt.Sprintf("Too big: expected number to be <=%v", *o.max))
		return x, false
	}
	return x, true
}

// num returns nil when the key is absent or null (or invalid).
func (f *form) num(key string, r rule, o numOpts) *float64 {
	v, _, done := f.take(key, "number", r)
	if done {
		return nil
	}
	x, _ := f.checkNumber(key, v, o)
	return &x
}

func (f *form) integer(key string, r rule, o numOpts) *int {
	o.integer = true
	x := f.num(key, r, o)
	if x == nil {
		return nil
	}
	n := int(*x)
	return &n
}

func (f *form) boolean(key string, r rule) *bool {
	v, _, done := f.take(key, "boolean", r)
	if done {
		return nil
	}
	b, ok := v.(bool)
	if !ok {
		f.fail(key, "invalid_type", "Invalid input: expected boolean, received "+typeName(v, true))
	}
	return &b
}

func (f *form) boolDefault(key string, def bool) bool {
	if b := f.boolean(key, rule{hasDefault: true}); b != nil {
		return *b
	}
	return def
}

/* ── arrays ──────────────────────────────────────────────────────────── */

// list validates z.array(...).max(max); each item is checked by each with a
// form rooted at the array. It returns nil when absent or null.
func (f *form) list(key string, r rule, max int, each func(items *form, i int, v any)) []any {
	v, _, done := f.take(key, "array", r)
	if done {
		return nil
	}
	items, ok := v.([]any)
	if !ok {
		f.fail(key, "invalid_type", "Invalid input: expected array, received "+typeName(v, true))
		return nil
	}
	sub := &form{path: f.at(key), issues: f.issues}
	for i, item := range items {
		each(sub, i, item)
	}
	if len(items) > max {
		f.fail(key, "too_big", fmt.Sprintf("Too big: expected array to have <=%d items", max))
	}
	if items == nil {
		items = []any{}
	}
	return items
}

func (f *form) strings(key string, r rule, max int, o strOpts) []string {
	out := []string{}
	items := f.list(key, r, max, func(sub *form, i int, v any) {
		s, _ := sub.checkString(i, v, o)
		out = append(out, s)
	})
	if items == nil {
		return nil
	}
	return out
}

func (f *form) ints(key string, r rule, max int, o numOpts) []int {
	o.integer = true
	out := []int{}
	items := f.list(key, r, max, func(sub *form, i int, v any) {
		x, _ := sub.checkNumber(i, v, o)
		out = append(out, int(x))
	})
	if items == nil {
		return nil
	}
	return out
}

// itemForm validates one array item as an object.
func (f *form) itemForm(i int, v any) *form {
	return &form{path: f.at(i), issues: f.issues, obj: f.object(i, v, true)}
}
