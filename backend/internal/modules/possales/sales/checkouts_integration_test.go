package sales

import (
	"net/http"
	"testing"

	"nuhabit/backend/internal/platform/testutil"
)

// callAll serves a request as the central cashier in "Semua Stall" mode.
func (e *env) callAll(method, path string, body any, status int) map[string]any {
	e.t.Helper()
	e.f.directory.central = true
	req := testutil.AsStaff(testutil.Request(method, path, body), e.staff)
	req.AddCookie(&http.Cookie{Name: "nuhabit-active-stall", Value: "all"})
	rec, out := testutil.Do(e.t, e.mux, req)
	if rec.Code != status {
		e.t.Fatalf("%s %s: status %d, want %d; body %s", method, path, rec.Code, status, rec.Body.String())
	}
	return out
}

func (e *env) mixedCart(extra map[string]any) map[string]any {
	body := map[string]any{
		"items": []any{
			map[string]any{"product_id": e.fx.prodA, "product_name": "Kopi", "quantity": 2, "unit_price": 20000, "station": "bar"},
			map[string]any{"product_id": e.fx.prodB, "product_name": "Roti", "quantity": 1, "unit_price": 15000, "modifier_price_adjustment": 2000},
			map[string]any{"product_id": e.fx.prodA2, "product_name": "Teh", "quantity": 3, "unit_price": 8000, "variant_price_adjustment": 1000},
		},
		"discount_amount": 5000, "tax_amount": 8000, "service_charge_amount": 4000,
		"payment_method": "cash", "amount_paid": 100000, "customer_id": e.fx.customer,
		"payment_method_code": "cash", "payment_method_name": "Tunai",
	}
	for k, v := range extra {
		body[k] = v
	}
	return body
}

func TestMixedCheckoutPaidSplitsPerStall(t *testing.T) {
	e := setup(t)
	out := e.callAll("POST", "/api/pos/checkouts", e.mixedCart(nil), 201)
	data := out["data"].(map[string]any)
	ids := data["order_ids"].([]any)
	if len(ids) != 2 || data["comp_approved_name"] != nil {
		t.Fatalf("data %v", data)
	}
	// Stall A: 40000 + 27000 = 67000, stall B: 17000; discount 5000 pro rata
	// floor (3988 / 1011, remainder to A), tax 8000 (6380 / 1619), service 4000.
	var subA, totalA, subB, totalB float64
	e.scalar(&subA, `SELECT subtotal::float8 FROM pos.pos_orders WHERE id = $1`, ids[0])
	e.scalar(&totalA, `SELECT total_amount::float8 FROM pos.pos_orders WHERE id = $1`, ids[0])
	e.scalar(&subB, `SELECT subtotal::float8 FROM pos.pos_orders WHERE id = $1`, ids[1])
	e.scalar(&totalB, `SELECT total_amount::float8 FROM pos.pos_orders WHERE id = $1`, ids[1])
	if subA != 67000 || subB != 17000 || totalA+totalB != 84000-5000+8000+4000 {
		t.Fatalf("A %v/%v B %v/%v", subA, totalA, subB, totalB)
	}
	// Characterization snapshot (checkout-flows "bayar tunai multi-stall"):
	// bakery child 17000 / disc 1011 / tax 1619 / service 809 / total 18417 /
	// paid 20238 / change 0; the first child takes the rest and the change.
	var got [2]string
	for i, id := range ids {
		e.scalar(&got[i], `SELECT concat_ws('/', subtotal::float8, discount_amount::float8, tax_amount::float8, service_charge_amount::float8,
			total_amount::float8, amount_paid::float8, change_amount::float8, guest_count, discount_reason) FROM pos.pos_orders WHERE id = $1`, id)
	}
	if got[0] != "67000/3989/6381/3191/72583/79762/9000/1" || got[1] != "17000/1011/1619/809/18417/20238/0/1" {
		t.Fatalf("children %v", got)
	}
	var lines string
	e.scalar(&lines, `SELECT string_agg(concat_ws('/', product_name, quantity::float8, unit_price::float8, subtotal::float8, total_amount::float8, cost_total::float8, gross_profit::float8, gross_margin_pct::float8, station), ' | ' ORDER BY product_name)
		FROM pos.pos_order_items WHERE order_id = $1`, ids[0])
	if lines != "Kopi/2/20000/40000/40000/2000/38000/95/bar | Teh/3/9000/27000/27000/3000/24000/88.89/bar" {
		t.Fatalf("lines %s", lines)
	}
	var status, method, code string
	e.scalar(&status, `SELECT status::text FROM pos.pos_orders WHERE id = $1`, ids[0])
	e.scalar(&method, `SELECT payment_method FROM pos.pos_orders WHERE id = $1`, ids[0])
	e.scalar(&code, `SELECT payment_method_code FROM pos.pos_orders WHERE id = $1`, ids[0])
	if status != "completed" || method != "cash" || code != "cash" {
		t.Fatalf("child %s %s %s", status, method, code)
	}
	if out["crm_xp"] != nil || out["ark_balance_after"] != nil || out["xp_total_after"] != nil {
		t.Fatalf("extras %v", out)
	}
	var events int
	e.scalar(&events, `SELECT count(*) FROM platform.outbox_events WHERE topic = 'pos.sale.completed' AND key = ANY($1::text[])`, []string{ids[0].(string), ids[1].(string)})
	if events != 2 {
		t.Fatalf("sale events %d", events)
	}
}

func TestOpenBillCheckoutThenComplete(t *testing.T) {
	e := setup(t)
	out := e.callAll("POST", "/api/pos/checkouts", e.mixedCart(map[string]any{"payment_status": "unpaid", "amount_paid": 0}), 201)
	data := out["data"].(map[string]any)
	if ids := data["order_ids"].([]any); len(ids) != 0 {
		t.Fatalf("unpaid checkout inserted children: %v", ids)
	}
	id := data["checkout_id"].(string)
	got := e.call(true, "GET", "/api/pos/checkouts/"+id, nil, 200)["data"].(map[string]any)
	if got["order_type"] != "dine_in" || got["payment_status"] != "unpaid" {
		t.Fatalf("checkout %v", got)
	}
	if out := e.call(true, "POST", "/api/pos/checkouts/"+id+"/complete", map[string]any{"payment_method": "cash", "amount_paid": 1}, 400); errorOf(out) != "Nominal tunai kurang dari total tagihan" {
		t.Fatalf("%v", out)
	}
	done := e.call(true, "POST", "/api/pos/checkouts/"+id+"/complete", map[string]any{"payment_method": "cash", "amount_paid": 100000}, 200)
	if ids := done["data"].(map[string]any)["order_ids"].([]any); len(ids) != 2 {
		t.Fatalf("complete %v", done)
	}
	var paid string
	e.scalar(&paid, `SELECT payment_status::text FROM pos.pos_checkouts WHERE id = $1`, id)
	if paid != "paid" {
		t.Fatalf("checkout %s", paid)
	}
	if out := e.call(true, "POST", "/api/pos/checkouts/"+id+"/cancel", nil, 400); errorOf(out) != "Checkout sudah lunas" {
		t.Fatalf("%v", out)
	}
}

func TestCancelChildlessCheckout(t *testing.T) {
	e := setup(t)
	out := e.callAll("POST", "/api/pos/checkouts", e.mixedCart(map[string]any{"payment_status": "unpaid", "amount_paid": 0}), 201)
	id := out["data"].(map[string]any)["checkout_id"].(string)
	res := e.call(true, "POST", "/api/pos/checkouts/"+id+"/cancel", nil, 200)
	if res["data"].(map[string]any)["checkout_id"] != id {
		t.Fatalf("%v", res)
	}
	var notes string
	e.scalar(&notes, `SELECT notes FROM pos.pos_checkouts WHERE id = $1`, id)
	if notes != "cancelled" {
		t.Fatalf("notes %q", notes)
	}
	// Idempotent.
	e.call(true, "POST", "/api/pos/checkouts/"+id+"/cancel", nil, 200)
	if out := e.call(true, "POST", "/api/pos/checkouts/00000000-0000-4000-8000-000000000000/cancel", nil, 404); errorOf(out) != "Checkout tidak ditemukan" {
		t.Fatalf("%v", out)
	}
}

func TestCheckoutGuards(t *testing.T) {
	e := setup(t)
	if out := e.call(true, "POST", "/api/pos/checkouts", e.mixedCart(nil), 400); errorOf(out) != "Keranjang campur stall hanya untuk kasir pusat" {
		t.Fatalf("%v", out)
	}
	if out := e.callAll("POST", "/api/pos/checkouts", e.mixedCart(map[string]any{"promo_code": "HEMAT"}), 400); errorOf(out) != "Promo belum didukung untuk checkout multi-stall" {
		t.Fatalf("%v", out)
	}
	if out := e.callAll("POST", "/api/pos/checkouts", e.mixedCart(map[string]any{"payment_method": "gift_card"}), 400); errorOf(out) != "Pembayaran NFC Tab / Gift Card belum didukung untuk checkout multi-stall" {
		t.Fatalf("%v", out)
	}
	if out := e.callAll("POST", "/api/pos/checkouts", e.mixedCart(map[string]any{"amount_paid": 10}), 400); errorOf(out) != "Payment insufficient" {
		t.Fatalf("%v", out)
	}
	if out := e.callAll("POST", "/api/pos/checkouts", e.mixedCart(map[string]any{"payment_method_code": "foc"}), 400); errorOf(out) != "Metode FOC membutuhkan PIN supervisor" {
		t.Fatalf("%v", out)
	}
	if out := e.callAll("POST", "/api/pos/checkouts", e.mixedCart(map[string]any{"payment_method_code": "foc", "supervisor_pin": "1234"}), 403); errorOf(out) != "PIN supervisor tidak valid" {
		t.Fatalf("%v", out)
	}
}
