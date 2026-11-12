package ticketing

import (
	"net/http"
	"testing"

	"nuhabit/backend/internal/platform/testutil"
)

// Each staff route opens only to the sub-modules whose dashboard pages call
// it. The venue stays unresolved, so a role past the guard gets 400.
func TestSubModuleGuards(t *testing.T) {
	deps := testutil.Deps(t, nil)
	mux := testutil.Mux(New(deps, Ports{Venues: fixedVenue{}, Employees: sqlEmployees{}, Messenger: &fakeMessenger{}}))
	roles := map[string]testutil.Staff{}
	for _, code := range []string{"ticketing.booking", "ticketing.loket", "ticketing.gate", "ticketing.gate_pass",
		"ticketing.passes", "ticketing.tickets", "ticketing.mapping", "ticketing.channel-manager",
		"ticketing.settings", "ticketing.reports", "pos.operations.cashier"} {
		roles[code] = testutil.CreateStaff(t, testutil.StaffOptions{Menus: map[string][]string{code: nil}})
	}
	cases := []struct {
		method, path string
		allowed      []string
		denied       []string
	}{
		{"GET", "/api/ticketing/bookings", []string{"ticketing.booking"}, []string{"ticketing.loket", "ticketing.settings"}},
		{"POST", "/api/ticketing/bookings/x/cancel", []string{"ticketing.booking"}, []string{"ticketing.loket", "ticketing.tickets"}},
		{"GET", "/api/ticketing/bookings/lookup?code=BK-AAAAAA", []string{"ticketing.loket"}, []string{"ticketing.booking"}},
		{"GET", "/api/ticketing/visits", []string{"ticketing.loket"}, []string{"ticketing.gate", "ticketing.booking"}},
		{"POST", "/api/ticketing/gate/tap", []string{"ticketing.gate"}, []string{"ticketing.loket", "ticketing.gate_pass"}},
		{"POST", "/api/ticketing/gate/pass-tap", []string{"ticketing.gate_pass"}, []string{"ticketing.gate", "ticketing.passes"}},
		{"GET", "/api/ticketing/season-passes", []string{"ticketing.passes"}, []string{"ticketing.gate_pass", "ticketing.loket"}},
		{"POST", "/api/ticketing/tab/check", []string{"pos.operations.cashier"}, []string{"ticketing.loket"}},
		{"GET", "/api/ticketing/occupancy?from=2026-10-01&to=2026-10-31", []string{"ticketing.booking", "ticketing.settings", "ticketing.reports"}, []string{"ticketing.loket"}},
		{"GET", "/api/ticketing/reports", []string{"ticketing.reports"}, []string{"ticketing.booking"}},
		{"GET", "/api/ticketing/settings", []string{"ticketing.settings", "ticketing.loket"}, []string{"ticketing.tickets"}},
		{"GET", "/api/ticketing/time-slots", []string{"ticketing.settings"}, []string{"ticketing.loket", "ticketing.tickets"}},
		{"GET", "/api/ticketing/products", []string{"ticketing.tickets", "ticketing.mapping"}, []string{"ticketing.channel-manager", "ticketing.loket"}},
		{"GET", "/api/ticketing/products/loket-options", []string{"ticketing.loket"}, []string{"ticketing.tickets"}},
		{"GET", "/api/ticketing/channel-manager", []string{"ticketing.channel-manager", "ticketing.tickets"}, []string{"ticketing.mapping"}},
		{"PATCH", "/api/ticketing/products/x/channels", []string{"ticketing.channel-manager"}, []string{"ticketing.tickets"}},
	}
	for _, c := range cases {
		status := func(code string) int {
			rec, _ := testutil.Do(t, mux, testutil.AsStaff(testutil.Request(c.method, c.path, map[string]any{}), roles[code]))
			return rec.Code
		}
		for _, code := range c.allowed {
			if got := status(code); got == http.StatusUnauthorized || got == http.StatusForbidden {
				t.Errorf("%s %s as %s: %d", c.method, c.path, code, got)
			}
		}
		for _, code := range c.denied {
			if got := status(code); got != http.StatusForbidden {
				t.Errorf("%s %s as %s: %d, want 403", c.method, c.path, code, got)
			}
		}
	}
}
