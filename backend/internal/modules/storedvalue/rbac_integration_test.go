package storedvalue

import (
	"testing"

	"nuhabit/backend/internal/platform/testutil"
)

// TestSubModuleGuards: Top-up, Unlink Card, Tagihan and Dompet each reach
// their own routes and none of their siblings'. Top-up and Unlink Card keep
// getPosSession's 401 for a missing grant.
func TestSubModuleGuards(t *testing.T) {
	staff := func(code string) testutil.Staff {
		return testutil.CreateStaff(t, testutil.StaffOptions{Menus: map[string][]string{code: nil}})
	}
	topup, unlink, bills, wallet := staff("pos.loyalty.topup"), staff("pos.loyalty.unlink-card"),
		staff("pos.operations.member-bills"), staff("pos.loyalty.wallet")
	e := newEnv(t)
	cases := []struct {
		name, path      string
		allow, sibling  testutil.Staff
		ok, siblingCode int
	}{
		{"top-up history", "/api/pos/topup", topup, unlink, 200, 401},
		{"counter packages", "/api/wallet/packages?scope=cashier", topup, wallet, 200, 403},
		{"member cards", "/api/pos/member-cards", unlink, topup, 200, 401},
		{"member bills", "/api/pos/member-bills", bills, topup, 200, 403},
		{"wallet branches", "/api/wallet/branches", wallet, bills, 200, 403},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			code, _, raw := e.do(c.allow, "GET", c.path, nil)
			expect(t, "allowed", code, c.ok, raw)
			code, _, raw = e.do(c.sibling, "GET", c.path, nil)
			expect(t, "sibling", code, c.siblingCode, raw)
		})
	}
}
