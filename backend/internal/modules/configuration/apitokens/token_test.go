package apitokens

import (
	"encoding/json"
	"math"
	"regexp"
	"testing"

	"nuhabit/backend/internal/platform/auth"
)

func TestIsValidScope(t *testing.T) {
	for scope, want := range map[string]bool{
		"*": true, "pos:read": true, "config:write": true, "pos:read:extra": true,
		"hr:delete": false, "pos": false, "pos:admin": false, "": false, "POS:read": false,
	} {
		if got := isValidScope(scope); got != want {
			t.Errorf("isValidScope(%q) = %v", scope, got)
		}
	}
}

func TestMint(t *testing.T) {
	m, err := mint()
	if err != nil {
		t.Fatal(err)
	}
	if !regexp.MustCompile(`^nh_[0-9a-f]{64}$`).MatchString(m.token) || m.prefix != m.token[:15] || m.hash != auth.HashToken(m.token) {
		t.Fatalf("minted = %+v", m)
	}
}

func TestJSCoercions(t *testing.T) {
	n := func(s string) any { return json.Number(s) }
	for _, c := range []struct {
		in   any
		want string
	}{{nil, "null"}, {true, "true"}, {n("42"), "42"}, {n("1.50"), "1.5"}, {"x", "x"}, {[]any{"a", nil, n("2")}, "a,,2"}, {map[string]any{}, "[object Object]"}} {
		if got := jsString(c.in); got != c.want {
			t.Errorf("String(%v) = %q, want %q", c.in, got, c.want)
		}
	}
	for _, c := range []struct {
		in   any
		want float64
	}{{nil, 0}, {true, 1}, {n("7"), 7}, {"2", 2}, {" ", 0}, {[]any{}, 0}, {[]any{"3"}, 3}} {
		if got := jsNumber(c.in); got != c.want {
			t.Errorf("Number(%v) = %v, want %v", c.in, got, c.want)
		}
	}
	for _, in := range []any{"abc", map[string]any{}, []any{n("1"), n("2")}} {
		if got := jsNumber(in); !math.IsNaN(got) {
			t.Errorf("Number(%v) = %v, want NaN", in, got)
		}
	}
	if jsTruthy("") || jsTruthy(n("0")) || jsTruthy(nil) || !jsTruthy([]any{}) || !jsTruthy("a") {
		t.Fatal("truthiness")
	}
}
