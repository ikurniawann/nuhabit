package events

import (
	"testing"

	"nuhabit/backend/internal/platform/testutil"
)

// TestSubModuleGuards: the calendar page owns the calendar and feeds, the
// CRM and site event pages own the link dialog, and shared dialogs admit
// both; a sibling menu is turned away.
func TestSubModuleGuards(t *testing.T) {
	e := setup(t)
	calendar := "/api/events/calendar?from=2026-11-02T00:00:00Z&to=2026-11-03T00:00:00Z"
	cases := []struct {
		path, allow, sibling string
	}{
		{calendar, "events.calendar", "crm.engagement.events"},
		{"/api/events/feeds", "events.calendar", "site.events"},
		{"/api/events/link/candidates?source=crm", "crm.engagement.events", "events.calendar"},
		{"/api/events/link/candidates?source=site", "site.events", "site.articles"},
		{"/api/events/options", "site.events", "crm.engagement.announcements"},
		{"/api/events/options", "events.calendar", "crm.engagement.challenges"},
	}
	for _, c := range cases {
		for code, want := range map[string]int{c.allow: 200, c.sibling: 403} {
			s := testutil.CreateStaff(t, testutil.StaffOptions{Menus: map[string][]string{code: {"read"}}, BranchID: &e.org.BranchID})
			if rec, _ := testutil.Do(t, e.mux, testutil.AsStaff(testutil.Request("GET", c.path, nil), s)); rec.Code != want {
				t.Errorf("GET %s as %s = %d, want %d: %s", c.path, code, rec.Code, want, rec.Body.String())
			}
		}
	}
}
