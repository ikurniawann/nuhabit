package domain

import (
	"bytes"
	"regexp"
	"testing"
	"time"
)

func p(s string) *string { return &s }

func TestNormalizeScope(t *testing.T) {
	h, c, b := p("h"), p("c"), p("b")
	for _, tc := range []struct {
		scope *string
		want  Scope
	}{
		{nil, Scope{}},
		{p("holding"), Scope{BusinessScope: p("holding"), HoldingID: h}},
		{p("company"), Scope{BusinessScope: p("company"), HoldingID: h, CompanyID: c}},
		{p("branch"), Scope{BusinessScope: p("branch"), HoldingID: h, CompanyID: c, BranchID: b}},
	} {
		got := NormalizeScope(tc.scope, h, c, b)
		if deref(got.BusinessScope) != deref(tc.want.BusinessScope) || got.HoldingID != tc.want.HoldingID ||
			got.CompanyID != tc.want.CompanyID || got.BranchID != tc.want.BranchID {
			t.Errorf("%v: got %+v", deref(tc.scope), got)
		}
	}
}

func deref(s *string) string {
	if s == nil {
		return "<nil>"
	}
	return *s
}

func TestValidateScope(t *testing.T) {
	for _, tc := range []struct {
		role   string
		access bool
		in     Scope
		want   string
	}{
		{"admin", false, Scope{}, ""},
		{"", true, Scope{}, ""},
		{"super_admin", true, Scope{}, ""},
		{"admin", true, Scope{}, "Data access scope is required for this role"},
		{"admin", true, Scope{BusinessScope: p("holding")}, "Holding is required"},
		{"admin", true, Scope{BusinessScope: p("company"), HoldingID: p("h")}, "Holding and company are required"},
		{"admin", true, Scope{BusinessScope: p("branch"), HoldingID: p("h"), CompanyID: p("c")}, "Holding, company, and branch are required"},
		{"admin", true, Scope{BusinessScope: p("branch"), HoldingID: p("h"), CompanyID: p("c"), BranchID: p("b")}, ""},
	} {
		if got := ValidateScope(tc.role, tc.access, tc.in); got != tc.want {
			t.Errorf("%+v: got %q want %q", tc, got, tc.want)
		}
	}
}

func TestStallRules(t *testing.T) {
	if RequiresStallAssignment("super_admin", p("branch"), true) || RequiresStallAssignment("admin", p("branch"), false) ||
		RequiresStallAssignment("", p("branch"), true) || RequiresStallAssignment("admin", p("company"), true) ||
		!RequiresStallAssignment("pos", p("branch"), true) {
		t.Error("requiresStallAssignment")
	}
	if got := DefaultWarehouseID(p("  w1 "), []string{"w2"}); deref(got) != "w1" {
		t.Errorf("explicit default trimmed: %v", deref(got))
	}
	if got := DefaultWarehouseID(p("  "), []string{"", "w2", "w3"}); deref(got) != "w2" {
		t.Errorf("first id: %v", deref(got))
	}
	if DefaultWarehouseID(nil, nil) != nil {
		t.Error("no default")
	}
	if got := SavedWarehouseIDs(p("w")); len(got) != 1 || got[0] != "w" {
		t.Errorf("saved %v", got)
	}
	if got := SavedWarehouseIDs(nil); got == nil || len(got) != 0 {
		t.Errorf("saved empty %v", got)
	}
}

func TestWorkflowMatchesModule(t *testing.T) {
	if !WorkflowMatchesModule("pos_void", "pos") || WorkflowMatchesModule("pos_void", "finance") || WorkflowMatchesModule("x", "pos") {
		t.Error("workflow module map")
	}
}

func TestAuthStatus(t *testing.T) {
	now := time.Date(2026, 10, 4, 10, 0, 0, 0, time.UTC)
	for in, want := range map[string]string{
		"2126-09-10 17:00:00.123456+07": "banned",
		"2026-10-04 16:59:59+07":        "enabled",
		"2026-10-04 17:00:01+07":        "banned",
		"2026-10-04 15:29:59+05:30":     "enabled",
		"infinity":                      "enabled",
	} {
		if got := AuthStatus(&in, now); got != want {
			t.Errorf("%s: got %s want %s", in, got, want)
		}
	}
	if AuthStatus(nil, now) != "enabled" {
		t.Error("nil ban")
	}
}

func TestTempPassword(t *testing.T) {
	got, err := TempPassword(bytes.NewReader([]byte{0xfb, 0xff, 0xbf, 1, 2, 3, 4, 5, 6}))
	if err != nil || got != "Arkiv-_-_AQIDBAUG!" {
		t.Fatalf("got %q %v", got, err)
	}
	if !regexp.MustCompile(`^Arkiv[A-Za-z0-9_-]{12}!$`).MatchString(got) {
		t.Fatal("format")
	}
	if _, err := TempPassword(bytes.NewReader(nil)); err == nil {
		t.Fatal("short random source")
	}
}
