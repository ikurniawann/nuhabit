package recruitment

import (
	"testing"

	"nuhabit/backend/internal/platform/testutil"
)

// Each recruitment route answers the sub-modules (leaf menus) whose pages
// call it: a role holding only that menu passes, a role holding only a
// sibling menu gets 403.
func TestSubModuleGuards(t *testing.T) {
	h := newHarness(t)
	missing := "00000000-0000-0000-0000-000000000000"
	candidate := h.candidate("applied")
	instrument := h.instrument("mcq", `{"duration_seconds": 600}`)
	cases := []struct {
		name, method, path string
		allow, sibling     string
		want               int
	}{
		{"candidate list: pipeline", "GET", "/api/candidates", "hris.recruitment.pipeline", "hris.recruitment.psikotes", 200},
		{"candidate list: talent pool", "GET", "/api/candidates", "hris.recruitment.talent-pool", "hris.recruitment.job-portal", 200},
		{"candidate detail", "GET", "/api/candidates/" + candidate + "/notes", "hris.recruitment.candidates", "hris.recruitment.talent-pool", 200},
		{"instrument picker", "GET", "/api/psikotes/instruments", "hris.recruitment.pipeline", "hris.recruitment.live-monitoring", 200},
		{"instrument questions", "GET", "/api/psikotes/instruments/" + instrument + "/questions", "hris.recruitment.psikotes", "hris.recruitment.pipeline", 200},
		{"job openings", "GET", "/api/hris/job-openings", "hris.recruitment.job-portal", "hris.recruitment.candidates", 200},
		{"live monitoring", "GET", "/api/recruitment/live-monitoring", "hris.recruitment.live-monitoring", "hris.recruitment.candidates", 200},
		{"pipeline report", "GET", "/api/candidates/" + missing + "/report", "hris.kepegawaian.users", "hris.kepegawaian.contracts", 404},
	}
	for _, c := range cases {
		allowed := testutil.CreateStaff(t, testutil.StaffOptions{Role: "hrd", Menus: map[string][]string{c.allow: nil}})
		sibling := testutil.CreateStaff(t, testutil.StaffOptions{Role: "hrd", Menus: map[string][]string{c.sibling: nil}})
		if got := h.as(sibling, c.method, c.path, nil); got.status != 403 {
			t.Errorf("%s as %s: status %d, want 403 (body %s)", c.name, c.sibling, got.status, got.raw)
		}
		if got := h.as(allowed, c.method, c.path, nil); got.status != c.want {
			t.Errorf("%s as %s: status %d, want %d (body %s)", c.name, c.allow, got.status, c.want, got.raw)
		}
	}
}
