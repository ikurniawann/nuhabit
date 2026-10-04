package sales

import (
	"testing"

	"nuhabit/backend/internal/modules/possales/ports"
)

func TestSingleOrderBalanceTenders(t *testing.T) {
	e := setup(t)
	// ARK Coin: debited through the wallet port, order marked paid.
	e.f.wallet.balance = 100000
	ark := e.call(true, "POST", "/api/pos/orders", e.cashOrder(map[string]any{
		"customer_id": e.fx.customer, "payment_method": "ark_coin", "amount_paid": 0, "ark_coins_used": 48000,
	}), 201)
	if ark["ark_balance_after"] != float64(52000) || ark["data"].(map[string]any)["payment_status"] != "paid" {
		t.Fatalf("ark %v", ark)
	}
	if m := e.f.wallet.moves; len(m) != 1 || m[0].Amount != -48000 || m[0].Type != "payment" {
		t.Fatalf("moves %+v", m)
	}
	// ARK without enough balance rolls the whole sale back.
	before := e.orderCount()
	if out := e.call(true, "POST", "/api/pos/orders", e.cashOrder(map[string]any{
		"customer_id": e.fx.customer, "payment_method": "ark_coin", "amount_paid": 0, "ark_coins_used": 60000, "total_amount": 60000,
	}), 400); errorOf(out) != "Saldo ARK Coin tidak cukup" || e.orderCount() != before {
		t.Fatalf("%v", out)
	}
	// NFC Tab: server total, charge port, paid.
	nfc := e.call(true, "POST", "/api/pos/orders", e.cashOrder(map[string]any{
		"payment_method": "nfc_tab", "nfc_tab_uid": "04:A2:B3:C4", "amount_paid": 0, "total_amount": 1,
	}), 201)["data"].(map[string]any)
	if nfc["payment_status"] != "paid" || nfc["total_amount"] != "48000.00" {
		t.Fatalf("nfc %v", nfc)
	}
	if out := e.call(true, "POST", "/api/pos/orders", e.cashOrder(map[string]any{"payment_method": "nfc_tab", "nfc_tab_uid": "x"}), 400); errorOf(out) != "UID gelang tidak valid — tap ulang gelang" {
		t.Fatalf("%v", out)
	}
	// Gift card needs a code.
	if out := e.call(true, "POST", "/api/pos/orders", e.cashOrder(map[string]any{"payment_method": "gift_card"}), 400); errorOf(out) != "Pembayaran gift card membutuhkan kode kartu" {
		t.Fatalf("%v", out)
	}
	gift := e.call(true, "POST", "/api/pos/orders", e.cashOrder(map[string]any{"payment_method": "gift_card", "gift_card_code": "gc-123"}), 201)["data"].(map[string]any)
	if gift["payment_status"] != "paid" {
		t.Fatalf("gift %v", gift)
	}
	// Merchandise stock rejection comes back with the claim's status.
	e.f.merch.reject = "Stok Kaos tidak cukup untuk jumlah yang diminta"
	if out := e.call(true, "POST", "/api/pos/orders", e.cashOrder(nil), 400); errorOf(out) != e.f.merch.reject {
		t.Fatalf("%v", out)
	}
}

func TestFocOrderWithSupervisorPin(t *testing.T) {
	e := setup(t)
	var hash string
	e.scalar(&hash, `SELECT pos_pin FROM configuration.users WHERE id = $1`, e.spv.UserID)
	name := "Spv Dua"
	e.f.directory.supervisors = []ports.Supervisor{{ID: e.spv.UserID, FullName: &name, PosPin: hash}}
	body := e.cashOrder(map[string]any{"payment_method_code": "foc", "payment_method_name": "FOC", "amount_paid": 0})
	if out := e.call(true, "POST", "/api/pos/orders", body, 400); errorOf(out) != "Metode FOC membutuhkan customer/member — pilih customer dulu" {
		t.Fatalf("%v", out)
	}
	body["customer_id"] = e.fx.customer
	body["supervisor_pin"] = "0000"
	if out := e.call(true, "POST", "/api/pos/orders", body, 403); errorOf(out) != "PIN supervisor tidak valid" {
		t.Fatalf("%v", out)
	}
	// The failed PIN is counted on the pool in production; here the pool is
	// the test transaction, so the sale's rollback also drops the count.
	body["supervisor_pin"] = "4321"
	data := e.call(true, "POST", "/api/pos/orders", body, 201)["data"].(map[string]any)
	if data["comp_type"] != "foc_comp" || data["total_amount"] != "0.00" || data["discount_amount"] != "48000.00" || data["comp_approved_name"] != "Spv Dua" {
		t.Fatalf("foc %v", data)
	}
	var events int
	e.scalar(&events, `SELECT count(*) FROM platform.outbox_events WHERE topic = 'pos.comp.approved' AND key = $1`, data["id"])
	if events != 1 {
		t.Fatalf("comp events %d", events)
	}
}

func TestCompleteCheckoutWithExistingChildrenFoc(t *testing.T) {
	e := setup(t)
	open := e.callAll("POST", "/api/pos/orders/open-bill", map[string]any{"table_id": "T3", "customer_id": e.fx.customer, "items": []any{
		map[string]any{"product_id": e.fx.prodA, "quantity": 1, "unit_price": 20000},
		map[string]any{"product_id": e.fx.prodB, "quantity": 1, "unit_price": 15000},
	}}, 201)["data"].(map[string]any)
	var hash string
	e.scalar(&hash, `SELECT pos_pin FROM configuration.users WHERE id = $1`, e.spv.UserID)
	name := "Spv Dua"
	e.f.directory.supervisors = []ports.Supervisor{{ID: e.spv.UserID, FullName: &name, PosPin: hash}}
	out := e.call(true, "POST", "/api/pos/checkouts/"+open["checkout_id"].(string)+"/complete", map[string]any{
		// The tender is checked before FOC applies, so the client sends the bill total.
		"payment_method": "cash", "amount_paid": 35000, "payment_method_code": "foc", "payment_method_name": "FOC", "supervisor_pin": "4321",
	}, 200)["data"].(map[string]any)
	if len(out["order_ids"].([]any)) != 2 || out["comp_approved_name"] != "Spv Dua" {
		t.Fatalf("complete %v", out)
	}
	var comp string
	e.scalar(&comp, `SELECT string_agg(concat_ws('/', comp_type, total_amount::float8, payment_status::text), ',' ORDER BY subtotal) FROM pos.pos_orders WHERE checkout_id = $1`, open["checkout_id"])
	if comp != "foc_comp/0/paid,foc_comp/0/paid" {
		t.Fatalf("children %s", comp)
	}
}

func (e *env) orderCount() int {
	var n int
	e.scalar(&n, `SELECT count(*) FROM pos.pos_orders WHERE company_id = $1`, e.fx.company)
	return n
}
