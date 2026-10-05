package sales

import (
	"testing"
)

func (e *env) cashOrder(extra map[string]any) map[string]any {
	e.t.Helper()
	body := map[string]any{
		"items": []any{
			map[string]any{"product_id": e.fx.prodA, "product_name": "Kopi", "quantity": 2, "unit_price": 20000, "station": "bar"},
			map[string]any{"product_id": e.fx.prodA2, "product_name": "Teh", "quantity": 1, "unit_price": "8000"},
		},
		"payment_method": "cash", "amount_paid": 50000, "total_amount": 48000,
	}
	for k, v := range extra {
		body[k] = v
	}
	return body
}

func TestOrdersRequirePosSession(t *testing.T) {
	e := setup(t)
	out := e.call(false, "GET", "/api/pos/orders", nil, 401)
	if errorOf(out) != "Authentication required" {
		t.Fatalf("body %v", out)
	}
	e.call(false, "POST", "/api/pos/orders", e.cashOrder(nil), 401)
}

func TestCreateSingleCashOrder(t *testing.T) {
	e := setup(t)
	out := e.call(true, "POST", "/api/pos/orders", e.cashOrder(map[string]any{"customer_id": e.fx.customer}), 201)
	data, _ := out["data"].(map[string]any)
	if data["payment_status"] != "paid" || data["status"] != "pending" || data["total_amount"] != "48000.00" {
		t.Fatalf("order %v", data)
	}
	if data["change_amount"] != "2000.00" || data["warehouse_id"] != e.fx.stallA || data["sold_from"] != "stall" {
		t.Fatalf("order %v", data)
	}
	items, _ := data["items"].([]any)
	if len(items) != 2 {
		t.Fatalf("items %v", data["items"])
	}
	// Items are embedded unordered; check the Kopi line.
	first := items[0].(map[string]any)
	if first["product_id"] != e.fx.prodA {
		first = items[1].(map[string]any)
	}
	if first["station"] != "bar" || first["quantity"] != float64(2) || first["total_amount"] != float64(40000) {
		t.Fatalf("item %v", first)
	}
	if out["crm_xp"].(map[string]any)["status"] != "skipped" || out["xp_total_after"] != float64(120) {
		t.Fatalf("xp %v %v", out["crm_xp"], out["xp_total_after"])
	}
	if _, ok := out["message"]; ok {
		t.Fatalf("message should be absent: %v", out)
	}
	id := data["id"].(string)
	var jobs, events int
	e.scalar(&jobs, `SELECT count(*) FROM pos.pos_print_jobs WHERE order_id = $1`, id)
	e.scalar(&events, `SELECT count(*) FROM platform.outbox_events WHERE key = $1`, id)
	if jobs != 1 || events != 2 {
		t.Fatalf("jobs %d events %d", jobs, events)
	}

	// GET /api/pos/orders/{id} and the list.
	got := e.call(true, "GET", "/api/pos/orders/"+id, nil, 200)["data"].(map[string]any)
	if got["stall_name"] != "Stall A" || got["customer"].(map[string]any)["name"] != "Budi" {
		t.Fatalf("detail %v", got)
	}
	list := e.call(true, "GET", "/api/pos/orders?q="+data["order_number"].(string), nil, 200)["data"].([]any)
	if len(list) != 1 || list[0].(map[string]any)["stall_code"] == nil {
		t.Fatalf("list %v", list)
	}
}

func TestCreateOrderGuards(t *testing.T) {
	e := setup(t)
	if out := e.call(true, "POST", "/api/pos/orders", map[string]any{"items": []any{}}, 400); errorOf(out) != "Items and total amount are required" {
		t.Fatalf("%v", out)
	}
	if out := e.call(true, "POST", "/api/pos/orders", e.cashOrder(map[string]any{"amount_paid": 1000}), 400); errorOf(out) != "Payment insufficient" {
		t.Fatalf("%v", out)
	}
	e.f.loyalty.arkEnabled = false
	out := e.call(true, "POST", "/api/pos/orders", e.cashOrder(map[string]any{"payment_method": "ark_coin"}), 409)
	if out["code"] != "ARK_COIN_DISABLED" {
		t.Fatalf("%v", out)
	}
	e.f.loyalty.arkEnabled = true
	mixed := e.cashOrder(nil)
	mixed["items"] = append(mixed["items"].([]any), map[string]any{"product_id": e.fx.prodB, "quantity": 1, "unit_price": 15000})
	if out := e.call(true, "POST", "/api/pos/orders", mixed, 400); errorOf(out) != "Keranjang campur stall hanya untuk kasir pusat" {
		t.Fatalf("%v", out)
	}
	if out := e.call(true, "GET", "/api/pos/orders/not-a-uuid", nil, 500); errorOf(out) != "Unknown error" {
		t.Fatalf("%v", out)
	}
}

func TestOpenBillStallOrder(t *testing.T) {
	e := setup(t)
	out := e.call(true, "POST", "/api/pos/orders/open-bill", map[string]any{
		"items": []any{map[string]any{"product_id": e.fx.prodA, "product_name": "Nasi Goreng", "quantity": 2, "unit_price": 25000,
			"discount_type": "percent", "discount_value": 10, "kitchen_notes": "pedas"}},
		"table_id": "T1", "tax_amount": 4500, "manual_discount_type": "fixed", "manual_discount_value": 1000,
	}, 201)
	if out["message"] != "Open bill created successfully" {
		t.Fatalf("%v", out)
	}
	data := out["data"].(map[string]any)
	// 50000 gross, 5000 line discount, 1000 manual → 44000 + 4500 tax.
	if data["payment_status"] != "unpaid" || data["subtotal"] != "50000.00" || data["discount_amount"] != "6000.00" || data["total_amount"] != "48500.00" {
		t.Fatalf("order %v", data)
	}
	if data["discount_reason"] != "ITEM line discounts; MANUAL Rp 1000" || data["cashier_id"] != e.staff.UserID || data["table_id"] != "T1" {
		t.Fatalf("order %v", data)
	}
	var station, notes string
	e.scalar(&station, `SELECT station FROM pos.pos_order_items WHERE order_id = $1`, data["id"])
	e.scalar(&notes, `SELECT payload->'items'->0->>'notes' FROM pos.pos_print_jobs WHERE order_id = $1`, data["id"])
	if station != "kitchen" || notes != "pedas" {
		t.Fatalf("station %q notes %q", station, notes)
	}
	if out := e.call(true, "POST", "/api/pos/orders/open-bill", map[string]any{}, 400); errorOf(out) != "Items are required" {
		t.Fatalf("%v", out)
	}
}

func TestOpenBillCentralAppendsToTableCheckout(t *testing.T) {
	e := setup(t)
	first := e.callAll("POST", "/api/pos/orders/open-bill", map[string]any{"table_id": "T9", "items": []any{
		map[string]any{"product_id": e.fx.prodA, "quantity": 1, "unit_price": 20000},
		map[string]any{"product_id": e.fx.prodB, "quantity": 1, "unit_price": 15000},
	}}, 201)["data"].(map[string]any)
	if len(first["order_ids"].([]any)) != 2 || first["table_id"] != "T9" {
		t.Fatalf("first %v", first)
	}
	second := e.callAll("POST", "/api/pos/orders/open-bill", map[string]any{"table_id": "T9", "items": []any{
		map[string]any{"product_id": e.fx.prodA2, "quantity": 2, "unit_price": 8000},
	}}, 201)["data"].(map[string]any)
	if second["checkout_id"] != first["checkout_id"] || len(second["order_ids"].([]any)) != 1 {
		t.Fatalf("second %v", second)
	}
	var total float64
	var items int
	e.scalar(&total, `SELECT total_amount::float8 FROM pos.pos_checkouts WHERE id = $1`, first["checkout_id"])
	e.scalar(&items, `SELECT jsonb_array_length(cart_snapshot->'items') FROM pos.pos_checkouts WHERE id = $1`, first["checkout_id"])
	if total != 51000 || items != 3 {
		t.Fatalf("total %v items %d", total, items)
	}
}
