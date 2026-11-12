package procurement_test

import (
	"testing"

	"nuhabit/backend/internal/platform/testutil"
)

// TestSubModuleGuards: each route passes a role granted one of the Items
// sub-modules whose pages call it and refuses a role granted only a sibling.
func TestSubModuleGuards(t *testing.T) {
	e := newEnv(t)
	roles := map[string]testutil.Staff{}
	as := func(code string) *testutil.Staff {
		s, ok := roles[code]
		if !ok {
			s = e.staff(map[string][]string{code: {"read", "create", "update", "delete"}})
			roles[code] = s
		}
		return &s
	}
	for _, c := range []struct {
		path          string
		allow, refuse []string
	}{
		{"/api/purchasing/po",
			[]string{"items.product.purchasing", "items.raw-material.purchasing", "items.general.purchasing", "items.product.approval", "items.raw-material.production"},
			[]string{"items.product.master.products", "items.raw-material.inventory", "items.reports"}},
		{"/api/purchasing/po/form-data?module_type=product", []string{"items.product.purchasing"}, []string{"items.product.approval"}},
		{"/api/purchasing/pr", []string{"items.general.purchasing", "items.raw-material.approval"}, []string{"items.general.inventory", "items.product.master"}},
		{"/api/purchasing/grn", []string{"items.raw-material.purchasing", "items.product.production"}, []string{"items.raw-material.inventory"}},
		{"/api/purchasing/delivery", []string{"items.product.purchasing"}, []string{"items.general.purchasing"}},
		{"/api/purchasing/returns", []string{"items.raw-material.purchasing"}, []string{"items.raw-material.approval"}},
		{"/api/purchasing/suppliers", []string{"items.raw-material.purchasing", "items.reports"}, []string{"items.raw-material.master"}},
		{"/api/purchasing/export/suppliers", []string{"items.raw-material.purchasing"}, []string{"items.product.purchasing"}},
		{"/api/purchasing/vendors", []string{"items.product.purchasing"}, []string{"items.raw-material.purchasing"}},
		{"/api/purchasing/vendor-payments", []string{"items.product.purchasing", "items.general.purchasing", "accounting.accounts-payable"}, []string{"items.raw-material.inventory"}},
		{"/api/purchasing/reports/po-summary", []string{"items.reports"}, []string{"items.product.purchasing"}},
		{"/api/purchasing/dashboard", []string{"items.product.approval"}, []string{"items.product.master"}},
	} {
		for _, code := range c.allow {
			if r := e.do(as(code), "GET", c.path, nil); r.Status != 200 {
				t.Errorf("%s as %s: %d, want 200: %s", c.path, code, r.Status, r.Raw)
			}
		}
		for _, code := range c.refuse {
			e.expect(e.do(as(code), "GET", c.path, nil), 403, "Insufficient permissions")
		}
	}
}
