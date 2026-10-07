package kit

import (
	"regexp"

	"nuhabit/backend/internal/platform/validate"
)

// datetimeZ is zod v4's z.string().datetime() without options: seconds and
// fractions optional, "Z" only (no offset, no local time).
var datetimeZ = regexp.MustCompile(`^(?:(?:\d\d[2468][048]|\d\d[13579][26]|\d\d0[48]|[02468][048]00|[13579][26]00)-02-29|\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\d|30)|(?:02)-(?:0[1-9]|1\d|2[0-8])))T(?:(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z))$`)

// DatetimeZCheck is z.string().datetime() (UTC "Z" only).
var DatetimeZCheck = func(s string) (string, string, bool) {
	return "invalid_format", "Invalid ISO datetime", datetimeZ.MatchString(s)
}

// RecordDefault is z.record(z.string(), z.unknown()).default({}): a JSON
// object, {} when absent.
func RecordDefault(f *validate.Form, key string) map[string]any {
	v, _, done := f.Take(key, "record", validate.Rule{HasDefault: true})
	if done {
		return map[string]any{}
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
		default:
			if _, isNum := v.(interface{ Float64() (float64, error) }); isNum {
				kind = "number"
			}
		}
		f.Fail(key, "invalid_type", "Invalid input: expected record, received "+kind)
		return map[string]any{}
	}
	return obj
}
