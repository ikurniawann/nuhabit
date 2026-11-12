package shop

import (
	"testing"

	"nuhabit/backend/internal/platform/testutil"
)

// TestSubModuleGuards runs the staff routes behind the real IAM guard: each
// admits the shop sub-modules whose pages call it and turns a sibling away.
func TestSubModuleGuards(t *testing.T) {
	f := newFixture(t)
	mux := testutil.Mux(mod{h: &handler{svc: f.svc, guard: testutil.Deps(t, nil).Auth}})
	order := f.order("paid")
	cases := []struct {
		method, path   string
		allow, sibling string
	}{
		{"GET", "/api/shop/orders", "shop.orders", "shop.wholesale"},
		{"GET", "/api/shop/reviews", "shop.orders", "shop.marketplace"},
		// The wholesale tab opens partner orders in the shared order dialog.
		{"GET", "/api/shop/orders/" + order, "shop.wholesale", "shop.settings"},
		{"GET", "/api/shop/wholesale/orders", "shop.wholesale", "shop.orders"},
		{"GET", "/api/shop/wholesale/accounts", "shop.wholesale", "shop.orders"},
		{"GET", "/api/shop/marketplace/accounts", "shop.marketplace", "shop.orders"},
		{"GET", "/api/shop/storefront-settings", "shop.settings", "shop.orders"},
		{"GET", "/api/shop/shipping/settings", "settings.shipping", "shop.orders"},
	}
	for _, c := range cases {
		for code, ok := range map[string]bool{c.allow: true, c.sibling: false} {
			staff := testutil.CreateStaff(t, testutil.StaffOptions{Role: "marketing", Menus: map[string][]string{code: nil}})
			rec, _ := testutil.Do(t, mux, testutil.AsStaff(testutil.Request(c.method, c.path, nil), staff))
			if ok && (rec.Code < 200 || rec.Code > 299) {
				t.Errorf("%s %s as %s: status %d, want 2xx: %s", c.method, c.path, code, rec.Code, rec.Body.String())
			}
			if !ok && rec.Code != 403 {
				t.Errorf("%s %s as %s: status %d, want 403", c.method, c.path, code, rec.Code)
			}
		}
	}
}
