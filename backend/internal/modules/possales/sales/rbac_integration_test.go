package sales

import (
	"testing"

	"nuhabit/backend/internal/platform/testutil"
)

// TestSubModuleGuards: each POS page role reaches its own sale routes and
// none of its siblings'. A cashier-only role sells end to end.
func TestSubModuleGuards(t *testing.T) {
	staff := func(code string) testutil.Staff {
		return testutil.CreateStaff(t, testutil.StaffOptions{Menus: map[string][]string{code: nil}})
	}
	// Created before setup so their cleanup runs after the rollback.
	cashier, orders, kds, transactions := staff("pos.operations.cashier"), staff("pos.operations.orders"),
		staff("pos.kitchen.kds"), staff("pos.reports.transactions")
	e := setup(t)
	for _, s := range []testutil.Staff{cashier, orders, kds, transactions} {
		e.exec(`UPDATE configuration.users SET default_warehouse_id = $1, business_scope = 'branch', company_id = $3, branch_id = $4 WHERE id = $2`,
			e.fx.stallA, s.UserID, e.fx.company, e.fx.branch)
	}
	as := func(s testutil.Staff, method, path string, body any, status int) map[string]any {
		t.Helper()
		e.staff = s
		return e.call(true, method, path, body, status)
	}

	order := as(cashier, "POST", "/api/pos/orders", e.cashOrder(nil), 201)["data"].(map[string]any)
	id := order["id"].(string)
	as(cashier, "GET", "/api/pos/orders", nil, 200)
	as(cashier, "GET", "/api/pos/orders/"+id, nil, 200)
	as(cashier, "POST", "/api/pos/orders/"+id+"/void", map[string]any{"reason": "x"}, 401)
	as(cashier, "PATCH", "/api/pos/orders/"+id+"/status", map[string]any{"status": "ready"}, 403)

	as(orders, "GET", "/api/pos/orders", nil, 200)
	as(orders, "POST", "/api/pos/orders", e.cashOrder(nil), 401)
	as(orders, "POST", "/api/pos/orders/open-bill", map[string]any{}, 401)

	as(transactions, "GET", "/api/pos/orders/"+id, nil, 200)
	as(transactions, "GET", "/api/pos/orders", nil, 401)

	e.staff = cashier
	open := e.openBillOrder()["id"].(string)
	as(kds, "PATCH", "/api/pos/orders/"+open+"/status", map[string]any{"status": "ready"}, 200)
	as(kds, "GET", "/api/pos/orders/"+open, nil, 401)
}
