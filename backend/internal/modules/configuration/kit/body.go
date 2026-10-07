package kit

import (
	"errors"
	"math"
	"net/http"
	"regexp"
	"strconv"
	"strings"

	"nuhabit/backend/internal/platform/validate"
)

// ErrInvalidJSON is what `await request.json()` throws on a missing or
// malformed body. apiHandler renders it as 500 "Terjadi kesalahan server".
var ErrInvalidJSON = errors.New("configuration: request body is not valid JSON")

// ReadJSON mirrors `await request.json()`: a missing or malformed body is
// ErrInvalidJSON. Numbers decode as json.Number for validate.
func ReadJSON(r *http.Request) (any, error) {
	v, ok := validate.ReadBody(r)
	if !ok {
		return nil, ErrInvalidJSON
	}
	return v, nil
}

// Form mirrors validateBody's first step: `await request.json()` (malformed
// is a 500), then a validate.Form over the value. Finish with
// f.Err("Validation failed").
func Form(r *http.Request) (*validate.Form, error) {
	v, err := ReadJSON(r)
	if err != nil {
		return nil, err
	}
	return validate.New(v, true), nil
}

// zodEmailBody is zod v4's email pattern without its two lookaheads, which
// IsEmail checks by hand: (?!\.) and (?!.*\.\.).
var zodEmailBody = regexp.MustCompile(`^([A-Za-z0-9_'+\-\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$`)

// IsEmail is z.string().email() in zod 4.
func IsEmail(s string) bool {
	return !strings.HasPrefix(s, ".") && !strings.Contains(s, "..") && zodEmailBody.MatchString(s)
}

// EmailCheck is z.string().email() as a validate.StrOpts check.
func EmailCheck(s string) (string, string, bool) {
	return "invalid_format", "Invalid email address", IsEmail(s)
}

// IsUUID is isUuid from lib/recruitment/candidate-query (any 8-4-4-4-12 hex).
var IsUUID = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`).MatchString

// jsDecimal is StrDecimalLiteral, what Number(string) accepts besides
// Infinity and the 0x/0o/0b integer forms.
var jsDecimal = regexp.MustCompile(`^[+-]?(\d+\.?\d*([eE][+-]?\d+)?|\.\d+([eE][+-]?\d+)?)$`)

// NumberFromString is Number(s) for a string: trimmed, "" is 0, anything
// JS cannot read is NaN.
func NumberFromString(s string) float64 {
	s = validate.JSTrim(s)
	switch s {
	case "":
		return 0
	case "Infinity", "+Infinity":
		return math.Inf(1)
	case "-Infinity":
		return math.Inf(-1)
	}
	if len(s) > 2 && s[0] == '0' {
		base := map[byte]int{'x': 16, 'X': 16, 'o': 8, 'O': 8, 'b': 2, 'B': 2}[s[1]]
		if base != 0 {
			n, err := strconv.ParseUint(s[2:], base, 64)
			if err != nil {
				return math.NaN()
			}
			return float64(n)
		}
	}
	if !jsDecimal.MatchString(s) {
		return math.NaN()
	}
	f, _ := strconv.ParseFloat(s, 64)
	return f
}
