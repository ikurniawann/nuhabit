package insights

import (
	"net/http"
	"testing"

	"nuhabit/backend/internal/platform/testutil"
)

// The recruitment dashboard and analytics answer the sub-modules (leaf
// menus) whose pages call them; a sibling menu gets 403.
func TestSubModuleGuards(t *testing.T) {
	cases := []struct{ path, allow, sibling string }{
		{"/api/dashboard/stats", "hris.recruitment.candidates", "hris.recruitment.talent-pool"},
		{"/api/dashboard/funnel", "hris.insights.analytics", "hris.insights.reports"},
		{"/api/analytics/overview", "hris.insights.analytics", "hris.insights.reports"},
		{"/api/analytics/sources", "hris.insights.analytics", "hris.recruitment.pipeline"},
	}
	h := newTxHarness(t)
	for _, c := range cases {
		allowed := testutil.CreateStaff(t, testutil.StaffOptions{Menus: map[string][]string{c.allow: nil}})
		sibling := testutil.CreateStaff(t, testutil.StaffOptions{Menus: map[string][]string{c.sibling: nil}})
		if got := h.get(c.path, sibling); got.status != http.StatusForbidden {
			t.Errorf("%s as %s: status %d, want 403 (%s)", c.path, c.sibling, got.status, got.raw)
		}
		if got := h.get(c.path, allowed); got.status != http.StatusOK {
			t.Errorf("%s as %s: status %d, want 200 (%s)", c.path, c.allow, got.status, got.raw)
		}
	}
}
