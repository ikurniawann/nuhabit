package auth

import (
	"os"
	"regexp"
	"strings"
	"testing"
)

func TestModuleForAPIPath(t *testing.T) {
	cases := map[string]string{
		"/api/pos/orders":               "pos",
		"/api/member-portal/orders/abc": "member",
		"/api/hris/employees":           "hris",
		"/api/admin/api-tokens":         "config",
		"/api/dashboard":                "reports",
		"/api/sesuatu-baru":             "other",
		"/api//POS/x":                   "pos",
	}
	for path, want := range cases {
		if got := ModuleForAPIPath(path); got != want {
			t.Errorf("ModuleForAPIPath(%q) = %q, want %q", path, got, want)
		}
	}
}

func TestScopeAllows(t *testing.T) {
	cases := []struct {
		scopes       []string
		path, method string
		want         bool
	}{
		{[]string{"*"}, "/api/pos/orders", "POST", true},
		{[]string{"*"}, "/api/hris/employees", "DELETE", true},
		{[]string{"pos:write"}, "/api/pos/orders", "POST", true},
		{[]string{"pos:write"}, "/api/pos/orders", "GET", true},
		{[]string{"pos:read"}, "/api/pos/orders", "GET", true},
		{[]string{"pos:read"}, "/api/pos/orders", "POST", false},
		{[]string{"pos:write"}, "/api/hris/employees", "GET", false},
		{[]string{}, "/api/pos/orders", "GET", false},
		{[]string{}, "/api/openapi.json", "GET", true},
		{[]string{}, "/api/openapi.json", "POST", false},
	}
	for _, c := range cases {
		if got := ScopeAllows(c.scopes, c.path, c.method); got != c.want {
			t.Errorf("ScopeAllows(%v, %s %s) = %v, want %v", c.scopes, c.method, c.path, got, c.want)
		}
	}
	if AccessForMethod("get") != "read" || AccessForMethod("HEAD") != "read" || AccessForMethod("PATCH") != "write" {
		t.Error("AccessForMethod mapping wrong")
	}
}

func TestExtractBearerToken(t *testing.T) {
	cases := map[string]string{
		"Bearer nh_abc123":       "nh_abc123",
		"Bearer arkiv_abc123":    "arkiv_abc123",
		"bearer arkiv_abc123":    "arkiv_abc123",
		"  Bearer nh_abc123  ":   "nh_abc123",
		"Bearer lainnya":         "",
		"Bearer nhx_abc":         "",
		"":                       "",
		"arkiv_tanpa_bearer":     "",
		"Bearer nh_a extra-part": "",
	}
	for in, want := range cases {
		if got := ExtractBearerToken(in); got != want {
			t.Errorf("ExtractBearerToken(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestBearerTokenFromAuthHeader(t *testing.T) {
	cases := map[string]string{
		"Bearer abc123":     "abc123",
		"bearer abc123":     "abc123",
		"BEARER   abc123":   "abc123",
		"  Bearer abc123  ": "abc123",
		"Basic abc123":      "",
		"abc123":            "",
		"Bearer ":           "",
		"":                  "",
	}
	for in, want := range cases {
		if got := BearerTokenFromAuthHeader(in); got != want {
			t.Errorf("BearerTokenFromAuthHeader(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestHashToken(t *testing.T) {
	// sha256("abc")
	if got := HashToken("abc"); got != "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad" {
		t.Fatalf("HashToken = %s", got)
	}
}

func TestIsLocalDatabase(t *testing.T) {
	cases := map[string]bool{
		"postgres://postgres@localhost:55432/nuhabit": true,
		"postgresql://u@127.0.0.1:5432/db":            true,
		"postgresql://u:p@db.example.com:5432/db":     false,
		"":          false,
		"bukan-url": false,
	}
	for in, want := range cases {
		if got := IsLocalDatabase(in); got != want {
			t.Errorf("IsLocalDatabase(%q) = %v, want %v", in, got, want)
		}
	}
}

func TestMemberOTPDevCode(t *testing.T) {
	const local = "postgres://postgres@localhost:55432/nuhabit"
	t.Setenv("NODE_ENV", "development")
	t.Setenv("MEMBER_OTP_DEV_CODE", "000000")

	s := NewService(nil, nil, nil, Options{DatabaseURL: local})
	if s.MemberOTPDevCode() != "000000" {
		t.Fatal("bypass should be active when all three guards pass")
	}
	if !s.CanBypassOTP("") || !s.CanBypassOTP("000000") || s.CanBypassOTP("000001") {
		t.Fatal("CanBypassOTP accepts empty or the dev code only")
	}
	if NewService(nil, nil, nil, Options{DatabaseURL: local, Production: true}).CanBypassOTP("000000") {
		t.Fatal("bypass must be off in production")
	}
	if NewService(nil, nil, nil, Options{DatabaseURL: "postgres://u@db.example.com/x"}).CanBypassOTP("000000") {
		t.Fatal("bypass must be off for a remote database")
	}
	t.Setenv("MEMBER_OTP_DEV_CODE", " ")
	if s.CanBypassOTP("") {
		t.Fatal("bypass must be off without MEMBER_OTP_DEV_CODE")
	}
	t.Setenv("MEMBER_OTP_DEV_CODE", "000000")
	t.Setenv("NODE_ENV", "production")
	if s.CanBypassOTP("") {
		t.Fatal("bypass must be off with NODE_ENV=production")
	}
}

func TestIsPublicAuthPath(t *testing.T) {
	for _, p := range []string{"/api/member-portal/me", "/api/health", "/api/auth/login", "/"} {
		if !IsPublicAuthPath(p) {
			t.Errorf("%s should be public", p)
		}
	}
	for _, p := range []string{"/api/auth/me", "/api/gym/packages", "/api/pos/orders"} {
		if IsPublicAuthPath(p) {
			t.Errorf("%s should not be public", p)
		}
	}
}

// TestPublicAuthPrefixesMatchMiddleware fails when PUBLIC_AUTH_PREFIXES in
// the Next middleware changes without this list following.
func TestPublicAuthPrefixesMatchMiddleware(t *testing.T) {
	raw, err := os.ReadFile("../../../../frontend/src/lib/auth/middleware.ts")
	if err != nil {
		t.Skipf("frontend source not available: %v", err)
	}
	src := string(raw)
	start := strings.Index(src, "const PUBLIC_AUTH_PREFIXES = [")
	end := strings.Index(src[start:], "\n];")
	if start < 0 || end < 0 {
		t.Fatal("PUBLIC_AUTH_PREFIXES not found in middleware.ts")
	}
	block := regexp.MustCompile(`(?m)//.*$`).ReplaceAllString(src[start:start+end], "")
	var ts []string
	for _, m := range regexp.MustCompile(`"([^"]+)"`).FindAllStringSubmatch(block, -1) {
		ts = append(ts, m[1])
	}
	if strings.Join(ts, "\n") != strings.Join(PublicAuthPrefixes, "\n") {
		t.Fatalf("PublicAuthPrefixes drifted from middleware.ts\nTS: %q\nGo: %q", ts, PublicAuthPrefixes)
	}
}
