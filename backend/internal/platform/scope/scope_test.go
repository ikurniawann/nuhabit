package scope

import "testing"

func p(s string) *string { return &s }

func val(s *string) string {
	if s == nil {
		return "<nil>"
	}
	return *s
}

func TestUnscopedRule(t *testing.T) {
	cases := []struct {
		role, level *string
		want        bool
	}{
		{p("super_admin"), p("branch"), true},
		{p("admin"), nil, true},
		{p("admin"), p(""), true},
		{p("admin"), p("company"), false},
		{nil, p("branch"), false},
	}
	for _, c := range cases {
		if got := New("u", c.role, c.level, nil, nil, nil).Unscoped; got != c.want {
			t.Errorf("role=%s level=%s: Unscoped=%v", val(c.role), val(c.level), got)
		}
	}
}

// Ported from frontend/src/lib/api/scope.test.ts.
func TestWarehouseFilters(t *testing.T) {
	company := New("u-1", p("admin"), p("company"), nil, p("co-apparel"), nil)
	if val(WarehouseCompanyFilter(company)) != "co-apparel" || val(WarehouseBranchFilter(company, p("br-ctx"))) != "br-ctx" {
		t.Fatal("company scope")
	}
	branch := New("u-1", p("admin"), p("branch"), nil, p("co-apparel"), p("br-workshop"))
	if WarehouseCompanyFilter(branch) != nil || val(WarehouseBranchFilter(branch, p("br-ctx"))) != "br-workshop" {
		t.Fatal("branch scope")
	}
	for _, s := range []*Scope{nil, New("u", p("super_admin"), nil, nil, nil, nil), New("u", p("admin"), p("holding"), p("h1"), nil, nil)} {
		if WarehouseCompanyFilter(s) != nil {
			t.Fatalf("unscoped/holding company filter = %v", val(WarehouseCompanyFilter(s)))
		}
	}
}

func TestEffectiveIDsAndFilters(t *testing.T) {
	branch := New("u", p("admin"), p("branch"), nil, p("c1"), p("b1"))
	company := New("u", p("admin"), p("company"), nil, p("c1"), p("b1"))
	holding := New("u", p("admin"), p("holding"), p("h"), p("c1"), nil)
	admin := New("u", p("super_admin"), p("branch"), nil, p("c1"), p("b1"))

	if val(EffectiveCompanyID(branch)) != "c1" || val(EffectiveBranchID(branch)) != "b1" || val(BranchFilter(branch)) != "b1" {
		t.Fatal("branch effective ids")
	}
	if val(EffectiveBranchID(company)) != "<nil>" || val(CompanyFilter(company)) != "c1" || BranchFilter(company) != nil {
		t.Fatal("company effective ids")
	}
	if CompanyFilter(holding) != nil || val(EffectiveCompanyID(holding)) != "c1" {
		t.Fatal("holding: no company filter, still writes under its company")
	}
	if EffectiveCompanyID(admin) != nil || CompanyFilter(admin) != nil {
		t.Fatal("super_admin writes global templates and sees everything")
	}
	if c, b := ImportBusinessIDs(admin); val(c) != "c1" || val(b) != "b1" {
		t.Fatal("imports keep the profile's company and branch even for super_admin")
	}
	if c, b := ImportBusinessIDs(company); val(c) != "c1" || b != nil {
		t.Fatal("company-level import has no branch")
	}
}

func TestRowChecks(t *testing.T) {
	branch := New("u", p("admin"), p("branch"), nil, p("c1"), p("b1"))
	company := New("u", p("admin"), p("company"), nil, p("c1"), nil)
	cases := []struct {
		name            string
		s               *Scope
		company, branch *string
		strict, oper    bool
	}{
		{"branch own row", branch, p("c1"), p("b1"), true, true},
		{"branch other branch", branch, p("c1"), p("b2"), false, false},
		{"branch legacy null row", branch, nil, nil, false, true},
		{"company own row", company, p("c1"), p("bX"), true, true},
		{"company other company", company, p("c2"), nil, false, false},
		{"company legacy null row", company, nil, nil, false, true},
		{"unscoped", nil, p("c9"), p("b9"), true, true},
	}
	for _, c := range cases {
		if got := RowInScope(c.s, c.company, c.branch); got != c.strict {
			t.Errorf("%s: RowInScope = %v", c.name, got)
		}
		if got := OperationalRowInScope(c.s, c.company, c.branch); got != c.oper {
			t.Errorf("%s: OperationalRowInScope = %v", c.name, got)
		}
	}
}
