package payroll

import (
	"encoding/json"
	"math"
	"net/http"
	"regexp"
	"strconv"

	"nuhabit/backend/internal/modules/payroll/domain"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/validate"
)

// Request parsing shared by the HRIS routes (lib/hris/workforce-route.ts and
// lib/payroll/request-input.ts): a failed schema is a 400 whose message is
// the route's message or the first issue's, with the issues as details.

// uuidRE is UUID_RE in workforce-route.ts (any version nibble).
var uuidRE = regexp.MustCompile(`^(?i)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

// requireUUID is requireUuid: a path id that is not a UUID is a 400.
func requireUUID(v, message string) (string, error) {
	if !uuidRE.MatchString(v) {
		if message == "" {
			message = "ID tidak valid"
		}
		return "", httpx.BadRequest(message)
	}
	return v, nil
}

// issuesErr is parseInput's failure: message, else the first issue's.
func issuesErr(f *validate.Form, message string) error {
	if f.Valid() {
		return nil
	}
	issues := f.Issues()
	if message == "" {
		message = issues[0].Message
	}
	return httpx.BadRequest(message, issues)
}

// readJSON is readJson: a body that is not JSON is a 400 (message or
// "Body JSON tidak valid") before any schema runs.
func readJSON(r *http.Request, message string) (*validate.Form, error) {
	body, ok := validate.ReadBody(r)
	if !ok {
		if message == "" {
			message = "Body JSON tidak valid"
		}
		return nil, httpx.BadRequest(message)
	}
	return validate.New(body, true), nil
}

// readOptionalJSON is readOptionalJson: a missing, invalid or null body is {}.
func readOptionalJSON(r *http.Request) *validate.Form {
	body, ok := validate.ReadBody(r)
	if !ok || body == nil {
		body = map[string]any{}
	}
	return validate.New(body, true)
}

// queryForm is searchParamsOf: the query string as an object, empty values
// treated as absent (the last value wins, as Object.fromEntries does).
func queryForm(r *http.Request) *validate.Form {
	m := map[string]any{}
	for k, vs := range r.URL.Query() {
		if v := vs[len(vs)-1]; v != "" {
			m[k] = v
		}
	}
	return validate.New(m, true)
}

// numRule describes z.coerce.number() with its refinements.
type numRule struct {
	validate.Rule
	validate.NumOpts
	// Message replaces every issue message ({ error: … } on the schema).
	Message string
}

// coerceNum reads key as z.coerce.number(): absent is undefined (an issue
// unless optional), null passes when nullable, anything else goes through
// Number() before the refinements. It returns nil when absent, null or invalid.
func coerceNum(f *validate.Form, key string, r numRule) *float64 {
	fields := f.Fields()
	if fields == nil {
		return nil
	}
	v, present := fields[key]
	switch {
	case !present && (r.Optional || r.HasDefault):
		return nil
	case present && v == nil && r.Nullable:
		return nil
	}
	before := len(f.Issues())
	n := domain.JSNumber(v)
	if !present {
		n = math.NaN()
	}
	ok := true
	if math.IsNaN(n) {
		f.Fail(key, "invalid_type", "Invalid input: expected number, received NaN")
		ok = false
	} else {
		_, ok = f.CheckNumber(key, json.Number(strconv.FormatFloat(n, 'g', -1, 64)), r.NumOpts)
	}
	if r.Message != "" {
		issues := f.Issues()
		for i := before; i < len(issues); i++ {
			issues[i].Message = r.Message
		}
	}
	if !ok {
		return nil
	}
	return &n
}

// coerceInt is coerceNum with Integer set, as an int.
func coerceInt(f *validate.Form, key string, r numRule) *int {
	r.Integer = true
	n := coerceNum(f, key, r)
	if n == nil {
		return nil
	}
	i := int(*n)
	return &i
}

// field reports whether the body has key (null included).
func field(f *validate.Form, key string) (any, bool) {
	fields := f.Fields()
	if fields == nil {
		return nil, false
	}
	v, ok := fields[key]
	return v, ok
}

func itoa(i int) string { return strconv.Itoa(i) }

// numParam formats a JS number the way node-postgres sends it (String(n)).
func numParam(n float64) string { return strconv.FormatFloat(n, 'f', -1, 64) }

// numOrNil is numParam for a nullable number.
func numOrNil(n *float64) any {
	if n == nil {
		return nil
	}
	return numParam(*n)
}
