package domain

import (
	"reflect"
	"strings"
	"testing"
	"time"
)

// Ported from lib/dataroom/access.test.ts, config.test.ts and
// shares.test.ts (the helpers the ported routes use).

func ptr(s string) *string { return &s }

func TestEvaluateAccess(t *testing.T) {
	cases := []struct {
		chain   [][]string
		dept    *string
		isAdmin bool
		want    bool
	}{
		{nil, ptr("hrd"), false, true},
		{[][]string{{}, nil}, nil, false, true},
		{[][]string{{"hrd", "fin"}}, ptr("hrd"), false, true},
		{[][]string{{"hrd", "fin"}}, ptr("ops"), false, false},
		{[][]string{{"hrd"}, {"hrd", "fin"}}, ptr("hrd"), false, true},
		// A subfolder open to fin under a parent only for hrd stays closed.
		{[][]string{{"fin"}, {"hrd"}}, ptr("fin"), false, false},
		{[][]string{{"hrd"}}, nil, false, false},
		{[][]string{{"hrd"}}, nil, true, true},
	}
	for i, c := range cases {
		if got := EvaluateAccess(c.chain, c.dept, c.isAdmin); got != c.want {
			t.Fatalf("case %d: got %v", i, got)
		}
	}
	if !IsAdminRole("super_admin") || IsAdminRole("admin") {
		t.Fatal("admin role")
	}
}

func TestConfigHelpers(t *testing.T) {
	for in, want := range map[string]string{
		"  Laporan/2026\\Q1.pdf ": "Laporan-2026-Q1.pdf", "ab": "ab", "": "Tanpa nama", "..": "Tanpa nama", "a\x00b\x7f": "ab",
	} {
		if got := SanitizeNodeName(in); got != want {
			t.Fatalf("sanitize %q: %q", in, got)
		}
	}
	if got := SanitizeNodeName(strings.Repeat("x", 300)); len(got) != 255 {
		t.Fatalf("length %d", len(got))
	}
	now := time.Date(2026, 9, 4, 0, 0, 0, 0, time.UTC)
	if got := ComputeExpiry(7, now); !got.Equal(time.Date(2026, 9, 11, 0, 0, 0, 0, time.UTC)) {
		t.Fatalf("expiry %v", got)
	}
	if got := ComputeExpiry(0, now); !got.Equal(now.Add(7 * 24 * time.Hour)) {
		t.Fatalf("default expiry %v", got)
	}
	if got := ComputeExpiry(9999, now); !got.Equal(now.Add(365 * 24 * time.Hour)) {
		t.Fatalf("max expiry %v", got)
	}
	if got := NormalizeEmails([]string{" A@x.com", "a@X.com", "b@y.id", "salah", ""}); !reflect.DeepEqual(got, []string{"a@x.com", "b@y.id"}) {
		t.Fatalf("emails %v", got)
	}
	if got := NormalizeEmails(nil); got == nil || len(got) != 0 {
		t.Fatalf("no emails %v", got)
	}
	if got := JSSlice("a😀b", 2); got != "a" {
		t.Fatalf("slice keeps surrogate pairs whole: %q", got)
	}
}

func TestShareHelpers(t *testing.T) {
	token := GenerateShareToken()
	if !ShareTokenRe.MatchString(token) || SessionCookieName(token) != "drs_"+token {
		t.Fatalf("token %q", token)
	}
	if !IsEmailAllowed([]string{"Budi@Wit.id"}, "budi@wit.id ") || IsEmailAllowed([]string{"budi@wit.id"}, "lain@wit.id") || IsEmailAllowed(nil, "") {
		t.Fatal("email allowed")
	}
	now := time.Date(2026, 9, 4, 10, 0, 0, 0, time.UTC)
	if !IsShareActive(false, time.Date(2026, 9, 5, 0, 0, 0, 0, time.UTC), now) ||
		IsShareActive(true, time.Date(2026, 9, 5, 0, 0, 0, 0, time.UTC), now) ||
		IsShareActive(false, time.Date(2026, 9, 4, 9, 59, 59, 0, time.UTC), now) {
		t.Fatal("share active")
	}
	steps := []struct {
		access          string
		pin, email, pok bool
		want            Steps
	}{
		{"public", false, false, false, Steps{false, false}},
		{"email", true, false, false, Steps{true, true}},
		{"email", true, true, false, Steps{false, true}},
		{"public", true, false, true, Steps{false, false}},
	}
	for _, c := range steps {
		if got := PendingSteps(c.access, c.pin, c.email, c.pok); got != c.want {
			t.Fatalf("steps %+v: %+v", c, got)
		}
	}
	a := HashEmailCode("s1", "A@x.com", "123456")
	if a != HashEmailCode("s1", "a@x.com", "123456") || a == HashEmailCode("s2", "a@x.com", "123456") || a == HashEmailCode("s1", "a@x.com", "654321") {
		t.Fatal("hash email code")
	}
}

func TestAttemptPolicyAndRateLimit(t *testing.T) {
	now := time.Date(2026, 10, 4, 12, 0, 0, 0, time.UTC)
	var s *AttemptState
	for i := 1; i <= 5; i++ {
		next := ApplyFailure(s, now, SharePinPolicy)
		s = &next
	}
	if s.Failures != 5 || s.LockedUntil == nil || !s.LockedUntil.Equal(now.Add(30*time.Minute)) {
		t.Fatalf("lock after five: %+v", s)
	}
	if MinutesUntil(*s.LockedUntil, now) != 30 || MinutesUntil(now, now) != 1 {
		t.Fatal("minutes until")
	}
	if fresh := ApplyFailure(s, now.Add(31*time.Minute), SharePinPolicy); fresh.Failures != 1 || fresh.LockedUntil != nil {
		t.Fatalf("expired lock restarts: %+v", fresh)
	}
}
