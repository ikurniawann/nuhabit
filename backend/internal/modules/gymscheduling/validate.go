package gymscheduling

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
	"unicode/utf16"

	"nuhabit/backend/internal/platform/httpx"
)

// Validation mirrors the zod schemas in frontend/src/lib/gym/scheduling-schemas.ts
// and parseInput in staff-route.ts: fields are checked in schema order, and
// the first failing field names the 400 ("Data tidak valid: <field>").
// Details carry zod-like issues; no client reads them.

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

var dateOnlyPattern = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)

// readBody mirrors `await request.json().catch(() => undefined)`: a body that
// is not JSON is treated as absent.
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

// fields validates one JSON object field by field.
type fields struct {
	obj    map[string]any
	issues []issue
}

func newFields(body any, present bool) *fields {
	f := &fields{}
	obj, ok := body.(map[string]any)
	if !ok {
		f.issues = append(f.issues, issue{
			Code: "invalid_type", Path: []any{},
			Message: "Invalid input: expected object, received " + typeName(body, present),
		})
		return f
	}
	f.obj = obj
	return f
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

// err returns the parseInput 400, or nil when every field passed.
func (f *fields) err() error {
	if len(f.issues) == 0 {
		return nil
	}
	first := f.issues[0]
	msg := "Data tidak valid"
	if len(first.Path) > 0 {
		msg = fmt.Sprintf("Data tidak valid: %v", first.Path[0])
	}
	return httpx.BadRequest(msg, f.issues)
}

func (f *fields) fail(key, code, msg string) {
	f.issues = append(f.issues, issue{Code: code, Path: []any{key}, Message: msg})
}

// lookup returns the raw value; ok is false when the key is absent (undefined).
// Without an object nothing is looked up: the root issue already failed.
func (f *fields) lookup(key string) (any, bool) {
	if f.obj == nil {
		return nil, false
	}
	v, ok := f.obj[key]
	return v, ok
}

// field rules shared by the typed getters.
type rule struct {
	optional bool // undefined allowed (no default)
	nullable bool // null allowed
}

// pre handles undefined/null. done=true means the getter returns the zero value.
func (f *fields) pre(key, expected string, r rule, hasDefault bool) (v any, isNull, done bool) {
	if f.obj == nil {
		return nil, false, true
	}
	v, ok := f.lookup(key)
	if !ok {
		if !r.optional && !hasDefault {
			f.fail(key, "invalid_type", "Invalid input: expected "+expected+", received undefined")
		}
		return nil, false, true
	}
	if v == nil {
		if !r.nullable {
			f.fail(key, "invalid_type", "Invalid input: expected "+expected+", received null")
		}
		return nil, true, true
	}
	return v, false, false
}

// strOpts describes a z.string() chain.
type strOpts struct {
	rule
	trim     bool
	min, max int
	def      *string
	check    func(string) (code, msg string, ok bool)
}

func utf16Len(s string) int { return len(utf16.Encode([]rune(s))) }

// str returns the value (nil when absent or null) and whether the key was sent.
func (f *fields) str(key string, o strOpts) (*string, bool) {
	_, sent := f.lookup(key)
	v, isNull, done := f.pre(key, "string", o.rule, o.def != nil)
	if done {
		if !sent && !isNull && o.def != nil && f.obj != nil {
			d := *o.def
			return &d, sent
		}
		return nil, sent
	}
	s, ok := v.(string)
	if !ok {
		f.fail(key, "invalid_type", "Invalid input: expected string, received "+typeName(v, true))
		return nil, sent
	}
	if o.trim {
		s = strings.TrimSpace(s)
	}
	n := utf16Len(s)
	switch {
	case o.min > 0 && n < o.min:
		f.fail(key, "too_small", fmt.Sprintf("Too small: expected string to have >=%d characters", o.min))
	case o.max > 0 && n > o.max:
		f.fail(key, "too_big", fmt.Sprintf("Too big: expected string to have <=%d characters", o.max))
	}
	if o.check != nil {
		if code, msg, ok := o.check(s); !ok {
			f.fail(key, code, msg)
		}
	}
	return &s, sent
}

func (f *fields) uuid(key string, r rule) *string {
	s, _ := f.str(key, strOpts{rule: r, check: func(s string) (string, string, bool) {
		return "invalid_format", "Invalid UUID", isUUID(s)
	}})
	return s
}

func (f *fields) enum(key string, r rule, def string, options ...string) *string {
	var d *string
	if def != "" {
		d = &def
	}
	quoted := make([]string, len(options))
	for i, o := range options {
		quoted[i] = `"` + o + `"`
	}
	s, _ := f.str(key, strOpts{rule: r, def: d, check: func(s string) (string, string, bool) {
		for _, o := range options {
			if s == o {
				return "", "", true
			}
		}
		return "invalid_value", "Invalid option: expected one of " + strings.Join(quoted, "|"), false
	}})
	return s
}

// datetime parses z.string().datetime({ offset: true }) into an instant.
func (f *fields) datetime(key string, r rule) *time.Time {
	s, _ := f.str(key, strOpts{rule: r, check: func(s string) (string, string, bool) {
		return "invalid_format", "Invalid ISO datetime", datetimePattern.MatchString(s)
	}})
	if s == nil || !datetimePattern.MatchString(*s) {
		return nil
	}
	t, ok := parseJSDate(*s)
	if !ok {
		return nil
	}
	return &t
}

// url mirrors z.string().trim().url(): an absolute URL with a scheme;
// special schemes need a host.
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

// intOpts describes z.number().int().min().max().
type intOpts struct {
	rule
	min, max int
	def      *int
}

func (f *fields) int(key string, o intOpts) *int {
	v, _, done := f.pre(key, "number", o.rule, o.def != nil)
	if done {
		if _, sent := f.lookup(key); !sent && o.def != nil && f.obj != nil {
			d := *o.def
			return &d
		}
		return nil
	}
	num, ok := v.(json.Number)
	if !ok {
		f.fail(key, "invalid_type", "Invalid input: expected number, received "+typeName(v, true))
		return nil
	}
	x, err := num.Float64()
	if err != nil || math.IsInf(x, 0) {
		f.fail(key, "invalid_type", "Invalid input: expected number, received number")
		return nil
	}
	if x != math.Trunc(x) {
		f.fail(key, "invalid_type", "Invalid input: expected int, received number")
		return nil
	}
	switch {
	case x < float64(o.min):
		f.fail(key, "too_small", fmt.Sprintf("Too small: expected number to be >=%d", o.min))
	case x > float64(o.max):
		f.fail(key, "too_big", fmt.Sprintf("Too big: expected number to be <=%d", o.max))
	}
	n := int(x)
	return &n
}

func (f *fields) boolean(key string, def bool) bool {
	v, _, done := f.pre(key, "boolean", rule{}, true)
	if done {
		return def
	}
	b, ok := v.(bool)
	if !ok {
		f.fail(key, "invalid_type", "Invalid input: expected boolean, received "+typeName(v, true))
		return def
	}
	return b
}

// parseJSDate parses the ISO forms `new Date(...)` accepts in these routes:
// RFC 3339 with optional seconds and any fraction, or Z/offset.
func parseJSDate(s string) (time.Time, bool) {
	for _, layout := range []string{time.RFC3339Nano, "2006-01-02T15:04Z07:00"} {
		if t, err := time.Parse(layout, s); err == nil {
			return t, true
		}
	}
	return time.Time{}, false
}
