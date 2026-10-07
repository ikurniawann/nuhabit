package sales

import "testing"

func (e *env) openBillOrder() map[string]any {
	e.t.Helper()
	return e.call(true, "POST", "/api/pos/orders/open-bill", map[string]any{
		"customer_id": e.fx.customer,
		"items":       []any{map[string]any{"product_id": e.fx.prodA, "product_name": "Kopi", "quantity": 2, "unit_price": 20000}},
	}, 201)["data"].(map[string]any)
}

func TestPatchSettlesOpenBill(t *testing.T) {
	e := setup(t)
	order := e.openBillOrder()
	path := "/api/pos/orders/" + order["id"].(string)
	if out := e.call(true, "PATCH", path, map[string]any{"payment_status": "paid", "payment_method": "cash", "amount_paid": 1000}, 400); errorOf(out) != "Nominal pembayaran (Rp1.000) kurang dari total bill "+order["order_number"].(string)+" (Rp40.000)" {
		t.Fatalf("%v", out)
	}
	if out := e.call(true, "PATCH", path, map[string]any{"payment_status": "paid", "payment_method": "qris", "amount_paid": 40000}, 400); errorOf(out) != "Menunggu pembayaran QRIS" {
		t.Fatalf("%v", out)
	}
	if out := e.call(true, "PATCH", path, map[string]any{"payment_status": "paid", "payment_method": "credit", "amount_paid": 41000}, 409); errorOf(out) == "" {
		t.Fatalf("%v", out)
	}
	out := e.call(true, "PATCH", path, map[string]any{"payment_status": "paid", "payment_method": "cash", "amount_paid": 50000, "payment_method_code": "cash", "payment_method_name": "Tunai"}, 200)
	data := out["data"].(map[string]any)
	if data["payment_status"] != "paid" || data["amount_paid"] != "50000.00" || data["payment_method_name"] != "Tunai" || data["queue_number"] == nil {
		t.Fatalf("data %v", data)
	}
	if out["crm_xp"].(map[string]any)["status"] != "skipped" || out["xp_total_after"] != float64(120) || out["ark_balance_after"] != nil {
		t.Fatalf("extras %v", out)
	}
	var events int
	e.scalar(&events, `SELECT count(*) FROM platform.outbox_events WHERE key = $1 AND topic IN ('pos.sale.completed', 'pos.sale.settled')`, order["id"])
	if events != 2 {
		t.Fatalf("events %d", events)
	}
	if out := e.call(true, "PATCH", "/api/pos/orders/00000000-0000-4000-8000-000000000000", map[string]any{"status": "ready"}, 404); errorOf(out) != "Order tidak ditemukan" {
		t.Fatalf("%v", out)
	}
}

func TestPatchArkCoinAndOwnerComp(t *testing.T) {
	e := setup(t)
	order := e.openBillOrder()
	path := "/api/pos/orders/" + order["id"].(string)
	e.f.wallet.balance = 100
	if out := e.call(true, "PATCH", path, map[string]any{"payment_status": "paid", "payment_method": "ark_coin", "ark_coins_used": 40000}, 400); errorOf(out) != "Saldo ARK Coin tidak cukup" {
		t.Fatalf("%v", out)
	}
	if out := e.call(true, "PATCH", path, map[string]any{"payment_status": "paid", "payment_method": "cash", "ark_coins_used": 100}, 400); errorOf(out) != "ARK Coin tidak bisa dicampur metode lain — 1 transaksi 1 metode pembayaran" {
		t.Fatalf("%v", out)
	}
	// Owner comp: a supervisor with a bcrypt PIN (pgcrypto, like bcryptjs).
	if out := e.call(true, "PATCH", path, map[string]any{"payment_status": "paid", "comp_type": "owner_comp", "supervisor_pin": "0000"}, 403); errorOf(out) != "PIN supervisor tidak valid" {
		t.Fatalf("%v", out)
	}
	out := e.call(true, "PATCH", path, map[string]any{"payment_status": "paid", "comp_type": "owner_comp", "supervisor_pin": "4321"}, 200)
	data := out["data"].(map[string]any)
	if data["comp_type"] != "owner_comp" || data["comp_approved_name"] != "Spv Dua" || data["total_amount"] != "0.00" || data["discount_amount"] != "40000.00" {
		t.Fatalf("data %v", data)
	}
}

func TestVerifyBcryptBPrefix(t *testing.T) {
	e := setup(t)
	// bcryptjs writes $2b$; pgcrypto reads the same hash as $2a$.
	var hash string
	e.scalar(&hash, `SELECT crypt('1234', gen_salt('bf', 4))`)
	b := "$2b$" + hash[4:]
	ok, err := verifyPosPin(e.ctx, e.tx, "1234", b)
	if err != nil || !ok {
		t.Fatalf("ok %v err %v", ok, err)
	}
	if ok, _ := verifyPosPin(e.ctx, e.tx, "9999", b); ok {
		t.Fatal("wrong pin accepted")
	}
	if ok, _ := verifyPosPin(e.ctx, e.tx, "1234", "1234"); !ok {
		t.Fatal("legacy plaintext rejected")
	}
}
