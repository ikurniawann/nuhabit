package salesfunnel

import (
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"sort"
	"strings"

	"nuhabit/backend/internal/modules/salesfunnel/domain"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/validate"
)

// Zod helpers the sales-funnel schemas share. Issues follow zod v4: field
// issues in schema order, object refines only when no field issue aborted
// (a type or enum failure), strict objects report unknown keys last.

var (
	opt     = validate.Rule{Optional: true}
	optNull = validate.Rule{Optional: true, Nullable: true}
	nullReq = validate.Rule{Nullable: true}
)

// errMalformedBody is `await request.json()` throwing: apiHandler answers 500.
var errMalformedBody = errors.New("request body is not valid JSON")

// form reads the body like validateBody: malformed JSON is a 500.
func form(r *http.Request) (*validate.Form, error) {
	body, present := validate.ReadBody(r)
	if !present {
		return nil, errMalformedBody
	}
	return validate.New(body, true), nil
}

func trimMax(max int) validate.StrOpts { return validate.StrOpts{Trim: true, Max: max} }
func trimRange(min, max int) validate.StrOpts {
	return validate.StrOpts{Trim: true, Min: min, Max: max}
}
func numRange(min, max float64) validate.NumOpts { return validate.NumOpts{Min: &min, Max: &max} }

// zodEmail is zod 4.4's email pattern without its lookaheads (no leading
// dot, no "..").
var zodEmail = regexp.MustCompile(`^([A-Za-z0-9_'+\-\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$`)

func emailCheck(s string) (string, string, bool) {
	ok := !strings.HasPrefix(s, ".") && !strings.Contains(s, "..") && zodEmail.MatchString(s)
	return "invalid_format", "Invalid email address", ok
}

func regexCheck(re *regexp.Regexp, jsPattern, msg string) func(string) (string, string, bool) {
	if msg == "" {
		msg = "Invalid string: must match pattern " + jsPattern
	}
	return func(s string) (string, string, bool) { return "invalid_format", msg, re.MatchString(s) }
}

var isoDateRe = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)

// isoDateCheck is z.string().regex(/^\d{4}-\d{2}-\d{2}$/).
var isoDateCheck = regexCheck(isoDateRe, `/^\d{4}-\d{2}-\d{2}$/`, "")

// calendarDateCheck is the regex plus refine(isValidCalendarDate): both run.
func calendarDate(f *validate.Form, key any, v any) (string, bool) {
	s, ok := f.CheckString(key, v, validate.StrOpts{Check: isoDateCheck})
	if _, isString := v.(string); !isString {
		return s, false
	}
	if !domain.IsValidCalendarDate(s) {
		f.Fail(key, "custom", "Tanggal tidak valid")
		ok = false
	}
	return s, ok
}

// has reports whether the body sent key (null included).
func has(f *validate.Form, key string) bool {
	_, ok := f.Fields()[key]
	return ok
}

// orEmpty is `<string schema>.optional().nullable().or(z.literal(""))`:
// "" passes as "", null as nil, other strings run the string schema, any
// other type fails both branches (invalid_union).
func orEmpty(f *validate.Form, key string, check func(f *validate.Form, v any) string) (val *string, present bool) {
	v, ok := f.Fields()[key]
	if !ok {
		return nil, false
	}
	switch x := v.(type) {
	case nil:
		return nil, true
	case string:
		if x == "" {
			return &x, true
		}
		s := check(f, v)
		return &s, true
	}
	f.Fail(key, "invalid_union", "Invalid input")
	return nil, true
}

func emailOrEmpty(f *validate.Form, key string, max int) (*string, bool) {
	return orEmpty(f, key, func(f *validate.Form, v any) string {
		s, _ := f.CheckString(key, v, validate.StrOpts{Trim: true, Max: max, Check: emailCheck})
		return s
	})
}

// record is z.record(z.string(), z.unknown()).optional(); nil when absent.
func record(f *validate.Form, key string) (map[string]any, bool) {
	v, _, done := f.Take(key, "record", opt)
	if done {
		return nil, false
	}
	obj, ok := v.(map[string]any)
	if !ok {
		kind := "object"
		switch v.(type) {
		case []any:
			kind = "array"
		case string:
			kind = "string"
		case bool:
			kind = "boolean"
		case json.Number:
			kind = "number"
		}
		f.Fail(key, "invalid_type", "Invalid input: expected record, received "+kind)
		return nil, false
	}
	return obj, true
}

// aborted reports a fatal issue (zod skips object refines after one).
func aborted(f *validate.Form) bool { return abortedSince(f, 0) }

// abortedSince reports a fatal issue recorded after the first n issues.
func abortedSince(f *validate.Form, n int) bool {
	for _, is := range f.Issues()[n:] {
		switch is.Code {
		case "invalid_type", "invalid_value", "invalid_union", "unrecognized_keys":
			return true
		}
	}
	return false
}

// strict is .strict(): unknown keys of the object at f, reported last.
func strict(f *validate.Form, known ...string) {
	var extra []string
	for k := range f.Fields() {
		if !domain.Contains(known, k) {
			extra = append(extra, k)
		}
	}
	if len(extra) == 0 {
		return
	}
	// JS object keys keep insertion order; JSON objects decode unordered,
	// so the message lists them sorted.
	sort.Strings(extra)
	quoted := make([]string, len(extra))
	for i, k := range extra {
		quoted[i] = `"` + k + `"`
	}
	msg := "Unrecognized key: " + quoted[0]
	if len(extra) > 1 {
		msg = "Unrecognized keys: " + strings.Join(quoted, ", ")
	}
	f.Fail(nil, "unrecognized_keys", msg)
}

// patchStr reads an optional (nullable) string into body when sent.
func patchStr(f *validate.Form, body *domain.Fields, key string, nullable bool, o validate.StrOpts) {
	if !has(f, key) {
		return
	}
	if nullable && f.Fields()[key] == nil {
		body.Set(key, nil)
		return
	}
	if s := f.Str(key, validate.Rule{Optional: true, Nullable: nullable}, o); s != nil {
		body.Set(key, *s)
	}
}

// patchEnum reads an optional enum into body when sent.
func patchEnum(f *validate.Form, body *domain.Fields, key string, options []string) {
	if !has(f, key) {
		return
	}
	if s := f.Enum(key, opt, options); s != nil {
		body.Set(key, *s)
	}
}

// patchNum reads an optional (nullable) number into body when sent.
func patchNum(f *validate.Form, body *domain.Fields, key string, nullable bool, o validate.NumOpts) {
	if !has(f, key) {
		return
	}
	if nullable && f.Fields()[key] == nil {
		body.Set(key, nil)
		return
	}
	if n := f.Num(key, validate.Rule{Optional: true, Nullable: nullable}, o); n != nil {
		body.Set(key, *n)
	}
}

// patchBool reads an optional boolean into body when sent.
func patchBool(f *validate.Form, body *domain.Fields, key string) {
	if !has(f, key) {
		return
	}
	if b := f.Bool(key, opt); b != nil {
		body.Set(key, *b)
	}
}

// validationErr is validateBody's 400.
func validationErr(f *validate.Form) error { return f.Err("Validation failed") }

// str returns *s or "" (an optional string's value or empty).
func str(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

// orNull is `value || null` for an optional string.
func orNull(s *string) any {
	if s == nil || *s == "" {
		return nil
	}
	return *s
}

// numOrNull is `value ?? null` for an optional number.
func numOrNull(n *float64) any {
	if n == nil {
		return nil
	}
	return *n
}

// badRequest is a 400 with the TS message.
func badRequest(msg string) error { return httpx.BadRequest(msg) }
