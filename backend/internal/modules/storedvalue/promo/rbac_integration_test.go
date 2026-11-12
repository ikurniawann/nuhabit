package promo

import (
	"testing"

	"nuhabit/backend/internal/platform/testutil"
)

// TestSubModuleGuards: Promo campaigns and the offer pages (bundling, BxGy,
// volume) reach their own routes; the shared lookups serve both, and the CRM
// Campaigns page reads the campaign list only.
func TestSubModuleGuards(t *testing.T) {
	e := setup(t)
	staff := func(code string) testutil.Staff {
		return testutil.CreateStaff(t, testutil.StaffOptions{Menus: map[string][]string{code: nil}})
	}
	campaigns, offers, crmCampaigns := staff("promo.campaigns"), staff("promo.offers.bxgy"), staff("crm.campaigns")
	as := func(s testutil.Staff, path string, status int) {
		t.Helper()
		e.staff = s
		e.call("GET", path, nil, status)
	}
	as(campaigns, "/api/promo/campaigns", 200)
	as(campaigns, "/api/promo/offers", 403)
	as(campaigns, "/api/promo/catalog", 200)

	as(offers, "/api/promo/offers?type=bxgy", 200)
	as(offers, "/api/promo/campaigns", 403)
	as(offers, "/api/promo/catalog", 200)

	as(crmCampaigns, "/api/promo/campaigns", 200)
	as(crmCampaigns, "/api/promo/catalog", 403)
}
