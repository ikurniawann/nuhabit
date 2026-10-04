package procurement

import (
	"encoding/json"
	"errors"
	"math"
	"regexp"
	"strconv"
	"strings"

	"nuhabit/backend/internal/modules/procurement/domain"
	"nuhabit/backend/internal/platform/validate"
)

// Zod behaviours validate.Form does not cover yet, built on its Take/Fail so
// issues stay in schema order. Candidates for platform/validate.

var isoDate = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)

// isoDateMessage is zod v4's z.string().regex(ISO_DATE) default message.
const isoDateMessage = `Invalid string: must match pattern /^\d{4}-\d{2}-\d{2}$/`

// enumField is z.enum(options): zod v4 reports a missing or non-string value
// as invalid_value, not invalid_type.
func enumField(f *validate.Form, key string, r validate.Rule, options []string) *string {
	if f.Fields() == nil {
		return nil
	}
	v, sent := f.Fields()[key]
	if !sent && (r.Optional || r.HasDefault) {
		return nil
	}
	if sent && v == nil && r.Nullable {
		return nil
	}
	s, ok := v.(string)
	_, _, valid := validate.EnumCheck(options)(s)
	if !ok || !valid {
		_, msg, _ := validate.EnumCheck(options)("")
		f.Fail(key, "invalid_value", msg)
		return nil
	}
	return &s
}

// customCheck is a z.string() format check with a custom message (the TS
// passes the message to .uuid() or .regex()).
func customCheck(base func(string) (string, string, bool), msg string) func(string) (string, string, bool) {
	return func(s string) (string, string, bool) {
		code, _, ok := base(s)
		return code, msg, ok
	}
}

// uuidMsg is z.string().uuid(msg).
func uuidMsg(msg string) validate.StrOpts {
	return validate.StrOpts{Check: customCheck(validate.UUIDCheck, msg)}
}

// isoDateCheck is z.string().regex(ISO_DATE[, msg]).
func isoDateCheck(msg string) validate.StrOpts {
	if msg == "" {
		msg = isoDateMessage
	}
	return validate.StrOpts{Check: func(s string) (string, string, bool) {
		return "invalid_format", msg, isoDate.MatchString(s)
	}}
}

// optionalDate is z.union([z.string().regex(ISO_DATE), z.literal(""),
// z.null()]).optional().transform(v => v || null).
func optionalDate(f *validate.Form, key string) *string {
	if f.Fields() == nil {
		return nil
	}
	v, sent := f.Fields()[key]
	if !sent || v == nil {
		return nil
	}
	s, ok := v.(string)
	if !ok {
		f.Fail(key, "invalid_union", "Invalid input")
		return nil
	}
	if s == "" {
		return nil
	}
	if !isoDate.MatchString(s) {
		f.Fail(key, "invalid_format", isoDateMessage)
		return nil
	}
	return &s
}

// blankToUndefined is the PR schemas' emptyToUndefined preprocess.
func blankToUndefined(v any, sent bool) (any, bool) {
	if !sent || v == nil {
		return nil, false
	}
	if s, ok := v.(string); ok && strings.TrimSpace(s) == "" {
		return nil, false
	}
	return v, true
}

// optionalBlankStr is z.preprocess(emptyToUndefined, z.string()[.uuid()].optional()).
func optionalBlankStr(f *validate.Form, key string, o validate.StrOpts) *string {
	if f.Fields() == nil {
		return nil
	}
	raw, sent := f.Fields()[key]
	v, present := blankToUndefined(raw, sent)
	if !present {
		return nil
	}
	s, _ := f.CheckString(key, v, o)
	return &s
}

// localeNumber is z.preprocess(v => parseLocaleNumber(v) ?? v, z.number()
// .min(min, minMsg).max(max, maxMsg)).
func localeNumber(f *validate.Form, key string, min float64, minMsg string, max float64, maxMsg string) float64 {
	if f.Fields() == nil {
		return 0
	}
	raw, sent := f.Fields()[key]
	if n, ok := domain.ParseLocaleNumber(raw); ok {
		raw = json.Number(formatJSNumber(n))
	}
	if !sent {
		f.Fail(key, "invalid_type", "Invalid input: expected number, received undefined")
		return 0
	}
	if raw == nil {
		f.Fail(key, "invalid_type", "Invalid input: expected number, received null")
		return 0
	}
	x, ok := f.CheckNumber(key, raw, validate.NumOpts{})
	switch {
	case !ok:
	case x < min:
		f.Fail(key, "too_small", minMsg)
	case x > max:
		f.Fail(key, "too_big", maxMsg)
	}
	return x
}

func formatJSNumber(n float64) string {
	b, _ := marshalJS(n)
	return string(b)
}

// numberMsg is z.number().min(min, msg) for a required field.
func numberMsg(f *validate.Form, key string, r validate.Rule, min float64, minMsg string) *float64 {
	v, _, done := f.Take(key, "number", r)
	if done {
		return nil
	}
	x, ok := f.CheckNumber(key, v, validate.NumOpts{})
	if ok && x < min {
		f.Fail(key, "too_small", minMsg)
	}
	return &x
}

// strMin1Msg is z.string().min(1, msg).
func strMin1Msg(msg string) validate.StrOpts {
	return validate.StrOpts{Check: func(s string) (string, string, bool) {
		return "too_small", msg, validate.UTF16Len(s) >= 1
	}}
}

// numDefault is z.number()….default(def) with the bounds.
func numDefault(f *validate.Form, key string, def float64, o validate.NumOpts) float64 {
	if x := f.Num(key, validate.Rule{HasDefault: true}, o); x != nil {
		return *x
	}
	return def
}

// listMin1 is z.array(item).min(1, msg).
func listMin1(f *validate.Form, key, msg string, each func(items *validate.Form, i int, v any)) []any {
	items := f.List(key, validate.Rule{}, 1<<30, each)
	if items != nil && len(items) == 0 {
		f.Fail(key, "too_small", msg)
	}
	return items
}

func jsonNumber(n float64) json.Number { return json.Number(formatJSNumber(n)) }

// parseJSNumber is Number(s) for a trimmed, non-empty string: decimal and
// exponent forms, 0x/0o/0b integers and ±Infinity; anything else is NaN.
func parseJSNumber(s string) (float64, bool) {
	switch s {
	case "Infinity", "+Infinity":
		return math.Inf(1), true
	case "-Infinity":
		return math.Inf(-1), true
	}
	if len(s) > 2 && s[0] == '0' {
		base := 0
		switch s[1] {
		case 'x', 'X':
			base = 16
		case 'o', 'O':
			base = 8
		case 'b', 'B':
			base = 2
		}
		if base != 0 {
			n, err := strconv.ParseUint(s[2:], base, 64)
			return float64(n), err == nil
		}
	}
	for _, c := range s {
		if !(c >= '0' && c <= '9') && !strings.ContainsRune(".eE+-", c) {
			return 0, false
		}
	}
	f, err := strconv.ParseFloat(s, 64)
	if err != nil && !errors.Is(err, strconv.ErrRange) {
		return 0, false
	}
	return f, true
}
