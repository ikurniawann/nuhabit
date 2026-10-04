package apitokens

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"math"
	"slices"
	"strconv"
	"strings"

	"nuhabit/backend/internal/modules/configuration/kit"
	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/validate"
)

// isValidScope is isValidScope: '*' or '<module>:read|write'. Like the TS
// split(":"), anything after a second colon is ignored.
func isValidScope(scope string) bool {
	if scope == "*" {
		return true
	}
	parts := strings.Split(scope, ":")
	if len(parts) < 2 {
		return false
	}
	return slices.Contains(auth.APIScopeModules, parts[0]) && (parts[1] == "read" || parts[1] == "write")
}

// minted is mintApiToken's result: the raw token is shown once, the
// database keeps its SHA-256 hash and a display prefix.
type minted struct{ token, hash, prefix string }

// mint is mintApiToken: nh_ plus 32 random bytes in hex.
func mint() (minted, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return minted{}, err
	}
	token := auth.APITokenPrefix + hex.EncodeToString(b)
	return minted{token: token, hash: auth.HashToken(token), prefix: token[:len(auth.APITokenPrefix)+12]}, nil
}

// jsTruthy is JavaScript truthiness of a decoded JSON value.
func jsTruthy(v any) bool {
	switch x := v.(type) {
	case nil:
		return false
	case bool:
		return x
	case string:
		return x != ""
	case json.Number:
		f, err := x.Float64()
		return err == nil && f != 0 && !math.IsNaN(f)
	}
	return true
}

// jsString is String(value) of a decoded JSON value.
func jsString(v any) string {
	switch x := v.(type) {
	case nil:
		return "null"
	case bool:
		return strconv.FormatBool(x)
	case string:
		return x
	case json.Number:
		f, err := x.Float64()
		if err != nil {
			return x.String()
		}
		return validate.JSNumber(f)
	case []any:
		parts := make([]string, len(x))
		for i, item := range x {
			if item != nil {
				parts[i] = jsString(item)
			}
		}
		return strings.Join(parts, ",")
	}
	return "[object Object]"
}

// jsNumber is Number(value) of a decoded JSON value (NaN when it does not
// convert).
func jsNumber(v any) float64 {
	switch x := v.(type) {
	case nil:
		return 0
	case bool:
		if x {
			return 1
		}
		return 0
	case json.Number:
		f, err := x.Float64()
		if err != nil {
			return math.NaN()
		}
		return f
	case string:
		return kit.NumberFromString(x)
	case []any:
		if len(x) == 0 {
			return 0
		}
		if len(x) == 1 {
			return jsNumber(jsString(x[0]))
		}
	}
	return math.NaN()
}

// orFallback is `a || b` over decoded JSON values.
func orFallback(a any, b any) any {
	if jsTruthy(a) {
		return a
	}
	return b
}
