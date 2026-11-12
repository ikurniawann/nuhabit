package salesfunnel_test

import (
	"net/http"
	"testing"

	"nuhabit/backend/internal/platform/testutil"
)

// Each route opens only to the menus whose dashboard pages call it.
func TestSubModuleGuards(t *testing.T) {
	e := newEnv(t)
	roles := map[string]testutil.Staff{}
	for _, code := range append(funnelMenus, "accounting", "crm.settings.workflows") {
		roles[code] = e.staff("admin", code)
	}
	cases := []struct {
		method, path string
		allowed      []string
		denied       []string
	}{
		{"GET", "/api/sales-funnel/leads", []string{"sales-funnel.leads", "sales-funnel.pipeline"}, []string{"sales-funnel.accounts", "sales-funnel.reports"}},
		{"GET", "/api/sales-funnel/leads/by-phone?phone=081234567890", []string{"sales-funnel.leads"}, []string{"sales-funnel.pipeline"}},
		{"GET", "/api/sales-funnel/deals", []string{"sales-funnel.pipeline"}, []string{"sales-funnel.leads", "sales-funnel.forecast"}},
		{"GET", "/api/sales-funnel/activities", []string{"sales-funnel.followups", "sales-funnel.leads", "sales-funnel.accounts", "sales-funnel.contacts", "sales-funnel.pipeline"}, []string{"sales-funnel.reports", "sales-funnel.settings"}},
		{"GET", "/api/sales-funnel/accounts", []string{"sales-funnel.accounts", "sales-funnel.contacts"}, []string{"sales-funnel.leads"}},
		{"GET", "/api/sales-funnel/contacts", []string{"sales-funnel.contacts"}, []string{"sales-funnel.accounts", "sales-funnel.leads"}},
		{"GET", "/api/sales-funnel/pipelines", []string{"sales-funnel.pipeline", "sales-funnel.leads", "sales-funnel.settings", "sales-funnel.forecast"}, []string{"sales-funnel.reports"}},
		{"GET", "/api/sales-funnel/stages", []string{"sales-funnel.pipeline", "sales-funnel.settings", "crm.settings.workflows"}, []string{"sales-funnel.leads"}},
		{"GET", "/api/sales-funnel/owners", []string{"sales-funnel.pipeline", "crm.settings.workflows"}, []string{"sales-funnel.leads"}},
		{"GET", "/api/sales-funnel/wa-templates", []string{"sales-funnel.settings", "sales-funnel.pipeline"}, []string{"sales-funnel.followups"}},
		{"GET", "/api/sales-funnel/forecast?month=2026-10", []string{"sales-funnel.forecast"}, []string{"sales-funnel.reports", "sales-funnel.pipeline"}},
		{"GET", "/api/sales-funnel/reports", []string{"sales-funnel.reports"}, []string{"sales-funnel.forecast"}},
		{"GET", "/api/sales-funnel/custom-fields?object=lead", []string{"sales-funnel.leads", "sales-funnel.pipeline", "sales-funnel.accounts", "sales-funnel.contacts"}, []string{"sales-funnel.reports"}},
		// Invoice viewers: accounting, or the pipeline page.
		{"GET", "/api/sales-funnel/deals/00000000-0000-0000-0000-000000000000/invoices", []string{"accounting", "sales-funnel.pipeline"}, []string{"sales-funnel.leads"}},
	}
	for _, c := range cases {
		for _, code := range c.allowed {
			s := roles[code]
			if r := e.do(&s, c.method, c.path, nil); r.Status == http.StatusUnauthorized || (r.Status == http.StatusForbidden && r.Body["error"] == "Insufficient permissions") {
				t.Errorf("%s %s as %s: %d %s", c.method, c.path, code, r.Status, r.Raw)
			}
		}
		for _, code := range c.denied {
			s := roles[code]
			if r := e.do(&s, c.method, c.path, nil); r.Status != http.StatusForbidden || r.Body["error"] != "Insufficient permissions" {
				t.Errorf("%s %s as %s: %d %s, want 403", c.method, c.path, code, r.Status, r.Raw)
			}
		}
	}
}
