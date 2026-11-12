package hris

import (
	"testing"

	"nuhabit/backend/internal/platform/testutil"
)

// Each HRIS route answers the sub-modules (leaf menus) whose pages call it:
// a role holding only that menu passes, a role holding only a sibling menu
// gets 403.
func TestSubModuleGuards(t *testing.T) {
	h := newHarness(t)
	worker := h.employee(emp{})
	cases := []struct {
		name, method, path string
		body               any
		allow, sibling     string
		want               int
	}{
		{"employee contracts tab", "GET", "/api/hris/employees/" + worker + "/contracts", nil,
			"hris.kepegawaian.users", "hris.kepegawaian.contracts", 200},
		{"contract list", "GET", "/api/hris/contracts", nil, "hris.kepegawaian.contracts", "hris.kepegawaian.users", 200},
		{"expiring contracts", "GET", "/api/hris/contracts/expiring", nil, "hris.kepegawaian.contracts", "hris.kepegawaian.shifts", 200},
		{"shift create", "POST", "/api/hris/shifts", map[string]any{"name": "RBAC", "start_time": "08:00", "end_time": "16:00"},
			"hris.kepegawaian.shifts", "hris.kepegawaian.holidays", 201},
		{"holiday create", "POST", "/api/hris/holidays", map[string]any{"holiday_date": "2031-08-18", "name": "RBAC", "status": "draft"},
			"hris.kepegawaian.holidays", "hris.kepegawaian.shifts", 201},
		{"announcement list", "GET", "/api/hris/announcements", nil, "hris.kepegawaian.announcements", "hris.kepegawaian.users", 200},
		{"employee picker: attendance", "GET", "/api/hris/employees", nil, "hris.workforce.attendance", "hris.kepegawaian.shifts", 200},
		{"employee picker: loans", "GET", "/api/hris/employees", nil, "hris.kepegawaian.loans", "hris.kepegawaian.holidays", 200},
		{"employee picker: feedback 360", "GET", "/api/hris/employees", nil, "hris.performance.feedback-360", "hris.performance.review", 200},
		{"employee picker: org chart", "GET", "/api/hris/employees", nil, "hris.organization.org-chart", "hris.organization.sections", 200},
		{"leave export", "GET", "/api/hris/leaves/export?leave_type=sick", nil, "hris.workforce.leaves", "hris.workforce.attendance", 404},
		{"attendance export", "GET", "/api/hris/attendance/export?employee_id=" + worker + "&start_date=2098-01-01&end_date=2098-01-31", nil,
			"hris.workforce.attendance", "hris.workforce.leaves", 404},
		{"hr report", "GET", "/api/hris/reports?month=10&year=2026", nil, "hris.insights.reports", "hris.insights.analytics", 200},
		{"department picker", "GET", "/api/master/departments", nil, "hris.master.positions", "hris.master.employment-statuses", 200},
		{"department create", "POST", "/api/master/departments", map[string]any{"name": "RBAC", "code": "rb" + testutil.RandomHex(3)},
			"hris.master.departments", "hris.master.positions", 201},
		{"status picker", "GET", "/api/master/employment-statuses", nil, "hris.kepegawaian.users", "hris.organization.org-chart", 200},
		{"position picker", "GET", "/api/master/positions", nil, "hris.recruitment.job-portal", "hris.recruitment.pipeline", 200},
	}
	for _, c := range cases {
		allowed, _ := h.staff("pos", []string{c.allow}, false)
		sibling, _ := h.staff("pos", []string{c.sibling}, false)
		if got := h.do(&sibling, c.method, c.path, c.body); got.status != 403 {
			t.Errorf("%s as %s: status %d, want 403 (body %s)", c.name, c.sibling, got.status, got.raw)
		}
		if got := h.do(&allowed, c.method, c.path, c.body); got.status != c.want {
			t.Errorf("%s as %s: status %d, want %d (body %s)", c.name, c.allow, got.status, c.want, got.raw)
		}
	}
}
