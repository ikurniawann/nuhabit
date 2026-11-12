package payroll

import (
	"testing"

	"nuhabit/backend/internal/platform/testutil"
)

// Each pay and performance route answers the sub-modules (leaf menus) whose
// pages call it: a role holding only that menu passes, a role holding only a
// sibling menu gets 403.
func TestSubModuleGuards(t *testing.T) {
	e := setup(t)
	missing := "00000000-0000-0000-0000-000000000000"
	cases := []struct {
		name, method, path string
		body               any
		allow, sibling     string
		want               int
	}{
		{"payroll runs", "GET", "/api/hris/payroll", nil, "hris.compensation.payroll", "hris.compensation.salary", 200},
		{"payroll settings", "GET", "/api/hris/payroll-settings", nil, "hris.compensation.payroll", "hris.compensation.salary", 200},
		{"salary list", "GET", "/api/hris/employee-salary", nil, "hris.compensation.salary", "hris.compensation.payroll", 200},
		{"loan approval", "POST", "/api/hris/loans/" + missing + "/approve", map[string]any{"approved": true},
			"hris.kepegawaian.loans", "hris.compensation.payroll", 404},
		{"kpi targets", "GET", "/api/hris/kpi/targets", nil, "hris.performance.kpi-scorecard", "hris.performance.kpi-config", 200},
		{"kpi config", "GET", "/api/hris/kpi-config", nil, "hris.performance.kpi-config", "hris.performance.kpi-scorecard", 200},
		{"kpi recommendation", "GET", "/api/hris/kpi/recommendation", nil, "hris.kepegawaian.contracts", "hris.performance.kpi-scorecard", 200},
		{"feedback categories", "GET", "/api/hris/feedback-categories", nil, "hris.performance.feedback-360", "hris.performance.kpi-scorecard", 200},
		{"feedback cycles", "GET", "/api/hris/feedback-cycles", nil, "hris.performance.feedback-360", "hris.performance.kpi-config", 200},
	}
	for _, c := range cases {
		allowed := testutil.CreateStaff(t, testutil.StaffOptions{Role: "hrd", Menus: map[string][]string{c.allow: nil}})
		sibling := testutil.CreateStaff(t, testutil.StaffOptions{Role: "hrd", Menus: map[string][]string{c.sibling: nil}})
		if rec := e.raw(&sibling, c.method, c.path, c.body); rec.Code != 403 {
			t.Errorf("%s as %s: status %d, want 403 (body %s)", c.name, c.sibling, rec.Code, rec.Body.String())
		}
		if rec := e.raw(&allowed, c.method, c.path, c.body); rec.Code != c.want {
			t.Errorf("%s as %s: status %d, want %d (body %s)", c.name, c.allow, rec.Code, c.want, rec.Body.String())
		}
	}
}
