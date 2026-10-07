package app

import (
	"context"
	"strings"
	"testing"

	"nuhabit/backend/internal/modules/storedvalue"
	"nuhabit/backend/internal/platform/testutil"
)

// A member bill closes every open order of a multi-stall checkout and then
// the checkout itself, through the real POS adapters. pos_checkouts stores
// the method in the pos_payment_method enum, the orders as text.
func TestMemberBillSettlesMultiStallCheckout(t *testing.T) {
	deps := testutil.Deps(t, nil)
	db := deps.DB
	ctx := context.Background()
	member := testutil.CreateMember(t)
	cashier := testutil.CreateStaff(t, testutil.StaffOptions{FullName: "Kasir Tagihan", Menus: map[string][]string{
		"pos": nil, "pos.operations.member-bills": {"read", "create"}}})

	suffix := testutil.RandomHex(4)
	var checkoutID string
	if err := db.QueryRow(ctx, `INSERT INTO pos.pos_checkouts (checkout_number, cashier_id, customer_id, subtotal, total_amount)
		VALUES ($1, $2, $3, 75000, 75000) RETURNING id::text`, "CO-GO-"+suffix, cashier.UserID, member.CustomerID).Scan(&checkoutID); err != nil {
		t.Fatal(err)
	}
	var orderIDs []string
	for i, total := range []int{50000, 25000} {
		var id string
		if err := db.QueryRow(ctx, `INSERT INTO pos.pos_orders (order_number, cashier_id, customer_id, checkout_id, status, subtotal, total_amount)
			VALUES ($1, $2, $3, $4, 'completed', $5, $5) RETURNING id::text`,
			"GO-MB-"+suffix+"-"+string(rune('A'+i)), cashier.UserID, member.CustomerID, checkoutID, total).Scan(&id); err != nil {
			t.Fatal(err)
		}
		orderIDs = append(orderIDs, id)
	}
	t.Cleanup(func() {
		ctx := context.Background()
		for _, sql := range []string{
			`DELETE FROM platform.outbox_events WHERE key IN (
			   SELECT id::text FROM pos.pos_orders WHERE customer_id = $1
			   UNION ALL SELECT id::text FROM pos.pos_member_bill_payments WHERE customer_id = $1)`,
			`DELETE FROM pos.pos_orders WHERE customer_id = $1`,
			`DELETE FROM pos.pos_member_bill_payments WHERE customer_id = $1`,
			`DELETE FROM pos.pos_member_bill_settlements WHERE customer_id = $1`,
			`DELETE FROM pos.pos_checkouts WHERE customer_id = $1`,
		} {
			if _, err := db.Exec(ctx, sql, member.CustomerID); err != nil {
				t.Errorf("cleanup %q: %v", sql, err)
			}
		}
	})

	mux := testutil.Mux(storedvalue.New(deps, storedValuePorts(deps)))
	req := testutil.AsStaff(testutil.Request("POST", "/api/pos/member-bills/"+member.CustomerID+"/payments",
		map[string]any{"amount": 75000, "payment_method_code": "cash"}), cashier)
	rec, _ := testutil.Do(t, mux, req)
	if rec.Code != 201 || !strings.Contains(rec.Body.String(), `"settled_order_count":2`) {
		t.Fatalf("settle: %d %s", rec.Code, rec.Body.String())
	}

	var paidOrders int
	if err := db.QueryRow(ctx, `SELECT count(*) FROM pos.pos_orders
		WHERE id = ANY($1::uuid[]) AND payment_status = 'paid' AND payment_method = 'member_bill'
		  AND payment_method_name = 'Tagihan Member' AND amount_paid = total_amount AND member_bill_settlement_id IS NOT NULL`,
		orderIDs).Scan(&paidOrders); err != nil || paidOrders != 2 {
		t.Fatalf("paid orders %d %v", paidOrders, err)
	}
	var status, method, code string
	var amountPaid float64
	if err := db.QueryRow(ctx, `SELECT payment_status::text, payment_method::text, payment_method_code, amount_paid::float8
		FROM pos.pos_checkouts WHERE id = $1`, checkoutID).Scan(&status, &method, &code, &amountPaid); err != nil {
		t.Fatal(err)
	}
	if status != "paid" || method != "member_bill" || code != "member_bill" || amountPaid != 75000 {
		t.Fatalf("checkout %s %s %s %v", status, method, code, amountPaid)
	}
}
