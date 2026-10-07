package hris

import (
	"regexp"

	"nuhabit/backend/internal/platform/validate"
)

// Zod helpers for the HRIS schemas, built on validate.Form. The HRIS schemas
// carry Indonesian messages (z.string({ error: msg }).min(1, msg)), which
// readJson surfaces as the 400 message, so the custom messages matter.

// opt is a parsed optional field: Sent says the key was in the body (a sent
// null has Val nil), which the update allowlists rely on.
type opt[T any] struct {
	Val  *T
	Sent bool
}

func sent(f *validate.Form, key string) bool {
	_, ok := f.Fields()[key]
	return ok
}

var (
	optional = validate.Rule{Optional: true}
	nullish  = validate.Rule{Optional: true, Nullable: true}
)

// str reads an optional string with zod's default messages.
func str(f *validate.Form, key string, r validate.Rule, o validate.StrOpts) opt[string] {
	return opt[string]{Val: f.Str(key, r, o), Sent: sent(f, key)}
}

// boolean reads an optional boolean.
func boolean(f *validate.Form, key string, r validate.Rule) opt[bool] {
	return opt[bool]{Val: f.Bool(key, r), Sent: sent(f, key)}
}

// number reads an optional number.
func number(f *validate.Form, key string, r validate.Rule, o validate.NumOpts) opt[float64] {
	return opt[float64]{Val: f.Num(key, r, o), Sent: sent(f, key)}
}

// reqStr is z.string({ error: msg }) followed by o (custom refinements go in
// o.Check): a missing or non-string value fails with msg.
func reqStr(f *validate.Form, key, msg string, o validate.StrOpts) *string {
	obj := f.Fields()
	if obj == nil {
		return nil
	}
	v, present := obj[key]
	if _, isStr := v.(string); !present || !isStr {
		f.Fail(key, "invalid_type", msg)
		return nil
	}
	s, _ := f.CheckString(key, v, o)
	return &s
}

// minLen is .min(n, msg).
func minLen(n int, msg string) func(string) (string, string, bool) {
	return func(s string) (string, string, bool) { return "too_small", msg, validate.UTF16Len(s) >= n }
}

// matches is .regex(re, msg).
func matches(re *regexp.Regexp, msg string) func(string) (string, string, bool) {
	return func(s string) (string, string, bool) { return "invalid_format", msg, re.MatchString(s) }
}

// both runs two checks, reporting the first failure (zod runs both but the
// first issue is what readJson shows).
func both(a, b func(string) (string, string, bool)) func(string) (string, string, bool) {
	return func(s string) (string, string, bool) {
		if code, msg, ok := a(s); !ok {
			return code, msg, false
		}
		return b(s)
	}
}

// uuidOf is z.string().uuid().
var uuidOf = validate.StrOpts{Check: validate.UUIDCheck}

// enumOf is z.enum(options) with an optional custom message.
func enumOf(options []string, msg string) validate.StrOpts {
	check := validate.EnumCheck(options)
	if msg == "" {
		return validate.StrOpts{Check: check}
	}
	return validate.StrOpts{Check: func(s string) (string, string, bool) {
		code, _, ok := check(s)
		return code, msg, ok
	}}
}

// rawValue is z.unknown(): the decoded JSON value (json.Number for numbers)
// and whether the key was present.
func rawValue(f *validate.Form, key string) (any, bool) {
	v, ok := f.Fields()[key]
	return v, ok
}

// strOr returns *p or "" for nil.
func strOr(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

// nilIfEmpty is `value || null` for a string.
func nilIfEmpty(p *string) *string {
	if p == nil || *p == "" {
		return nil
	}
	return p
}
