package posops_test

import (
	"testing"

	"nuhabit/backend/internal/platform/testutil"
)

// TestSubModuleGuards: a role holding only the page's menu reaches the
// route; a role holding only a sibling POS menu does not. Routes kept from
// getPosSession answer the missing grant with 401, the others with 403.
func TestSubModuleGuards(t *testing.T) {
	h := newHarness(t, map[string][]string{})
	const days = "date_from=2031-01-01&date_to=2031-01-02"
	cases := []struct {
		name, path, allow, deny string
		denied                  int
	}{
		{"dashboard", "/api/pos/dashboard", "pos.reports.dashboard", "pos.reports.profit", 401},
		{"stock alerts", "/api/pos/stock-alerts", "pos.catalog.stock-alerts", "pos.catalog.channel-prices", 401},
		{"table board for reservations", "/api/pos/tables", "pos.operations.reservation", "pos.operations.gofood", 401},
		{"reservations from the cashier", "/api/pos/reservations", "pos.operations.cashier", "pos.operations.tables", 401},
		{"void report", "/api/pos/reports/voids?" + days, "pos.reports.voids", "pos.reports.profit", 401},
		{"profit report", "/api/pos/reports/profit?" + days, "pos.reports.profit", "pos.reports.voids", 401},
		{"closing shifts", "/api/pos/shifts", "pos.reports.closing", "pos.reports.voids", 401},
		{"current shift for member bills", "/api/pos/shifts/current?cashier_id=00000000-0000-4000-8000-000000000001", "pos.operations.member-bills", "pos.operations.orders", 401},
		{"member search for top-up", "/api/pos/customers", "pos.loyalty.topup", "pos.loyalty.wallet", 401},
		{"products for the cashier", "/api/pos/products", "pos.operations.cashier", "pos.catalog.stock-alerts", 403},
		{"products for CRM settings", "/api/pos/products", "crm.settings.config", "crm.settings.scoring", 403},
		{"payment methods page", "/api/pos/payment-methods", "pos.loyalty.payment-methods", "pos.loyalty.unlink-card", 401},
		{"ARK rate on gym desk receipts", "/api/pos/loyalty-settings", "gym.credits", "gym.members", 401},
		{"billing profile settings", "/api/pos/billing-settings", "settings.billing", "pos.operations.orders", 401},
		{"export per report", "/api/pos/reports/export?report=voids&" + days, "pos.reports.voids", "pos.reports.profit", 403},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			allowed := testutil.CreateStaff(t, testutil.StaffOptions{Menus: map[string][]string{c.allow: nil}})
			sibling := testutil.CreateStaff(t, testutil.StaffOptions{Menus: map[string][]string{c.deny: nil}})
			h.t = t
			h.do(testutil.AsStaff(testutil.Request("GET", c.path, nil), allowed), 200)
			h.do(testutil.AsStaff(testutil.Request("GET", c.path, nil), sibling), c.denied)
		})
	}
}
