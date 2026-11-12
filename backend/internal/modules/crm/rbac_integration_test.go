package crm

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"nuhabit/backend/internal/platform/testutil"
)

// Each CRM route answers the leaf menus whose pages call it: a role with
// that menu gets 2xx, a role with only a sibling menu gets 403.
func TestRoutesFollowSubModuleMenus(t *testing.T) {
	m := New(testutil.Deps(t, nil), Ports{})
	mux := http.NewServeMux()
	for _, r := range m.Routes() {
		mux.Handle(r.Pattern, r.Handler)
	}
	staff := map[string]testutil.Staff{}
	as := func(code string) testutil.Staff {
		if s, ok := staff[code]; ok {
			return s
		}
		s := testutil.CreateStaff(t, testutil.StaffOptions{Role: "admin", Menus: map[string][]string{code: {"read"}}})
		staff[code] = s
		return s
	}
	call := func(path, code string) int {
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, testutil.AsStaff(testutil.Request("GET", path, nil), as(code)))
		return w.Code
	}

	for _, c := range []struct{ path, allowed, sibling string }{
		{"/api/crm/dashboard", "crm.overview.dashboard", "crm.members.list"},
		{"/api/crm/members", "crm.members.list", "crm.members.inbox"},
		{"/api/crm/members", "crm.loyalty.rewards", "crm.loyalty.avatars"},
		{"/api/crm/rewards", "crm.loyalty.rewards", "crm.loyalty.avatars"},
		{"/api/crm/rewards", "crm.members.list", "crm.loyalty.partners"},
		{"/api/crm/avatars", "crm.loyalty.avatars", "crm.badges"},
		{"/api/crm/badges", "crm.badges", "crm.wallpapers"},
		{"/api/crm/wallpapers", "crm.wallpapers", "crm.badges"},
		{"/api/crm/tiers", "crm.engagement.announcements", "crm.engagement.events"},
		{"/api/crm/settings", "crm.settings.config", "crm.settings.scoring"},
		{"/api/crm/xp-rules", "crm.settings.config", "crm.members.list"},
		{"/api/crm/approval-rules", "crm.settings.approvals", "crm.settings.workflows"},
		{"/api/crm/workflow-rules", "crm.settings.workflows", "crm.settings.scoring"},
		{"/api/crm/scoring-rules", "crm.settings.scoring", "crm.settings.custom-fields"},
		{"/api/crm/custom-fields", "crm.settings.custom-fields", "crm.settings.approvals"},
		{"/api/crm/approvals", "sales-funnel.approvals", "crm.settings.approvals"},
		{"/api/crm/engagement/announcements", "crm.engagement.announcements", "crm.engagement.challenges"},
		{"/api/crm/engagement/challenges", "crm.engagement.challenges", "crm.engagement.events"},
		{"/api/crm/engagement/checkins", "crm.engagement.checkins", "crm.engagement.announcements"},
		{"/api/crm/engagement/events", "crm.engagement.events", "crm.engagement.checkins"},
		{"/api/crm/inbox/conversations", "crm.members.inbox", "crm.members.reviews"},
		{"/api/crm/member-reviews", "crm.members.member-reviews", "crm.members.reviews"},
		{"/api/crm/partners", "crm.loyalty.partners", "crm.loyalty.rewards"},
		{"/api/crm/campaigns", "crm.campaigns", "crm.marketing.segments"},
		{"/api/crm/segments", "crm.marketing.segments", "crm.marketing.forms"},
		{"/api/crm/segments", "crm.campaigns", "crm.marketing.attribution"},
		{"/api/crm/forms", "crm.marketing.forms", "crm.marketing.segments"},
		{"/api/crm/collectibles/idle-report", "crm.reports.overview", "crm.reports.builder"},
		{"/api/crm/report-builder/datasets", "crm.reports.builder", "crm.reports.dashboards"},
		{"/api/crm/report-builder", "crm.reports.dashboards", "crm.marketing.attribution"},
		{"/api/crm/dashboards", "crm.reports.dashboards", "crm.reports.builder"},
		{"/api/crm/report-schedules", "crm.reports.schedules", "crm.reports.dashboards"},
		{"/api/crm/loyalty-features", "pos.operations.cashier", "crm.settings.config"},
	} {
		if got := call(c.path, c.allowed); got < 200 || got > 299 {
			t.Errorf("GET %s as %s = %d, want 2xx", c.path, c.allowed, got)
		}
		if got := call(c.path, c.sibling); got != http.StatusForbidden {
			t.Errorf("GET %s as %s = %d, want 403", c.path, c.sibling, got)
		}
	}
	// Google reviews needs the Google port, which this module has nil; the
	// inbox package covers the allowed side.
	if got := call("/api/crm/reviews", "crm.members.inbox"); got != http.StatusForbidden {
		t.Errorf("GET /api/crm/reviews as crm.members.inbox = %d, want 403", got)
	}
}
