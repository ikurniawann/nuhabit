package posops_test

import (
	"strings"
	"testing"

	"nuhabit/backend/internal/platform/testutil"
)

// order inserts a pos_orders row; table may be "".
func (h *harness) order(shiftID any, status, payStatus, method string, code any, total float64, table string) string {
	h.t.Helper()
	var tableID any
	if table != "" {
		tableID = table
	}
	return h.id(`INSERT INTO pos.pos_orders (order_number, cashier_id, shift_id, status, payment_status,
		payment_method, payment_method_code, subtotal, total_amount, amount_paid, table_id)
		VALUES ('GT-' || substr(md5(random()::text), 1, 12), $1, $2, $3::pos_order_status, $4::pos_payment_status,
		NULLIF($5, ''), $6, $7, $7, $7, $8) RETURNING id::text`,
		h.staff.UserID, shiftID, status, payStatus, method, code, total, tableID)
}

func (h *harness) customer() string {
	h.t.Helper()
	return h.id(`INSERT INTO pos.pos_customers (phone, name) VALUES ('+6298' || floor(random()*1e9)::bigint, 'Go POS Test') RETURNING id::text`)
}

func TestShiftsLifecycle(t *testing.T) {
	h := newHarness(t, nil)

	r := h.anon("GET", "/api/pos/shifts", nil, 401)
	jsonEq(t, r.body, `{"success":false,"error":"Unauthorized"}`)
	r = h.anon("POST", "/api/pos/shifts/x/send-report", nil, 401)
	jsonEq(t, r.body, `{"success":false,"error":"Authentication required"}`)

	r = h.call("POST", "/api/pos/shifts", map[string]any{"opening_cash": 5}, 400)
	jsonEq(t, r.body, `{"success":false,"error":"cashier_id required"}`)

	r = h.call("POST", "/api/pos/shifts", map[string]any{"cashier_id": h.staff.UserID, "opening_cash": 100000}, 200)
	shift := data(r)
	shiftID := shift["id"].(string)
	if !strings.HasPrefix(shift["shift_number"].(string), "SHF-") || shift["opening_cash"] != "100000.00" ||
		shift["status"] != "active" || shift["opened_by"] != h.staff.UserID || shift["notes"] != "" || shift["variance"] != "0.00" {
		t.Fatalf("opened shift = %v", shift)
	}
	keysInOrder(t, r.raw, "success", "data", "id", "shift_number", "cashier_id", "branch_id", "opened_at", "opening_cash", "variance", "status", "updated_at")

	r = h.call("POST", "/api/pos/shifts", map[string]any{"cashier_id": h.staff.UserID}, 409)
	if r.body["error"] != "Cashier already has an active shift" || obj(r.body["active_shift"])["id"] != shiftID {
		t.Fatalf("conflict body = %s", r.raw)
	}
	keysInOrder(t, r.raw, "success", "error", "active_shift", "id", "shift_number", "opened_at")

	r = h.call("GET", "/api/pos/shifts/current", nil, 400)
	jsonEq(t, r.body, `{"success":false,"error":"cashier_id required"}`)
	r = h.call("GET", "/api/pos/shifts/current?cashier_id=nope", nil, 500)
	jsonEq(t, r.body, `{"success":false,"error":"invalid input syntax for type uuid: \"nope\""}`)

	// Orders: drawer cash, QRIS, a custom "cash" code (Transfer BCA, counted
	// as card), a cancelled one and an unpaid one (both ignored).
	cash := h.order(shiftID, "completed", "paid", "cash", nil, 50000, "")
	h.order(shiftID, "completed", "paid", "qris", nil, 25000, "")
	h.order(shiftID, "completed", "partial", "cash", "transfer_bca", 10000, "")
	h.order(shiftID, "cancelled", "paid", "cash", nil, 99000, "")
	h.order(shiftID, "pending", "unpaid", "cash", nil, 77000, "")
	customer := h.customer()
	h.exec(`INSERT INTO pos.pos_member_bill_payments (customer_id, amount, payment_method, shift_id) VALUES ($1, 20000, 'cash', $2), ($1, 5000, 'qris', $2)`, customer, shiftID)

	r = h.call("GET", "/api/pos/shifts/current?cashier_id="+h.staff.UserID, nil, 200)
	if data(r)["id"] != shiftID || len(list(data(r)["pos_orders"])) != 5 {
		t.Fatalf("current = %s", r.raw)
	}
	if first := obj(list(data(r)["pos_orders"])[0]); len(first) != 1 {
		t.Fatalf("current embeds only ids: %v", first)
	}

	r = h.call("GET", "/api/pos/shifts?cashier_id="+h.staff.UserID+"&status=active&limit=abc", nil, 500)
	jsonEq(t, r.body, `{"success":false,"error":"invalid input syntax for type bigint: \"NaN\""}`)
	r = h.call("GET", "/api/pos/shifts?cashier_id="+h.staff.UserID+"&status=active", nil, 200)
	if r.body["count"] != float64(1) || len(list(r.body["data"])) != 1 {
		t.Fatalf("list = %s", r.raw)
	}
	keysInOrder(t, r.raw, "success", "data", "pos_orders", "count")
	for _, o := range list(obj(list(r.body["data"])[0])["pos_orders"]) {
		if obj(o)["id"] == cash {
			jsonEq(t, o, `{"id":"`+cash+`","total_amount":50000,"payment_method":"cash","amount_paid":50000,"ark_coins_used":0}`)
		}
	}

	r = h.call("PATCH", "/api/pos/shifts/"+shiftID+"/close", map[string]any{}, 400)
	jsonEq(t, r.body, `{"success":false,"error":"closing_cash required"}`)
	r = h.call("PATCH", "/api/pos/shifts/not-a-uuid/close", map[string]any{"closing_cash": 1}, 404)
	jsonEq(t, r.body, `{"success":false,"error":"Shift not found"}`)

	r = h.call("PATCH", "/api/pos/shifts/"+shiftID+"/close", map[string]any{"closing_cash": 165000, "notes": "tutup"}, 200)
	jsonEq(t, r.body["summary"], `{"total_orders":3,"total_sales":85000,"opening_cash":"100000.00","expected_cash":170000,
		"closing_cash":165000,"variance":-5000,
		"method_breakdown":{"cash":50000,"qris":25000,"debit":0,"credit":10000,"ark_coin":0,"nfc_tab":0},
		"member_bill_payments":{"cash":20000,"qris":5000,"card":0,"total":25000}}`)
	closed := data(r)
	if closed["status"] != "closed" || closed["expected_cash"] != "170000.00" || closed["variance"] != "-5000.00" ||
		closed["total_sales"] != "85000.00" || closed["total_orders"] != float64(3) || closed["notes"] != "tutup" ||
		closed["closed_by"] != h.staff.UserID {
		t.Fatalf("closed = %v", closed)
	}
	keysInOrder(t, r.raw, "success", "data", "summary")

	r = h.call("PATCH", "/api/pos/shifts/"+shiftID+"/close", map[string]any{"closing_cash": 1}, 400)
	jsonEq(t, r.body, `{"success":false,"error":"Shift is not active"}`)

	// Send report: recipients come from Settings.
	r = h.call("POST", "/api/pos/shifts/"+testutil.RandomHex(4)+"/send-report", nil, 404)
	jsonEq(t, r.body, `{"success":false,"error":"Shift tidak ditemukan"}`)
	h.exec(`DELETE FROM configuration.app_settings WHERE key = 'pos_shift_report_wa_recipients'`)
	r = h.call("POST", "/api/pos/shifts/"+shiftID+"/send-report", nil, 400)
	jsonEq(t, r.body, `{"success":false,"error":"Belum ada nomor penerima laporan tutup kasir — isi dulu di Settings → Notifikasi WA"}`)

	h.exec(`INSERT INTO configuration.app_settings (key, value) VALUES ('pos_shift_report_wa_recipients', '["0812-3456-789", "+62 812 3456 789", "12", "0811111111"]')`)
	h.wa.fail["62811111111"] = "nomor tidak aktif"
	r = h.call("POST", "/api/pos/shifts/"+shiftID+"/send-report", nil, 200)
	jsonEq(t, r.body, `{"success":true,"data":{"terkirim":1,"total":2,"rincian":[
		{"phone":"628123456789","success":true},{"phone":"62811111111","success":false,"reason":"nomor tidak aktif"}]}}`)
	msg := h.wa.sent[0].message
	for _, want := range []string{"*Laporan Tutup Kasir — ", "Shift: SHF-", "Jumlah transaksi: 3", "*Total penjualan: Rp 85.000*",
		"Kas awal: Rp 100.000", "Kas seharusnya: Rp 170.000", "Kas fisik: Rp 165.000", "Selisih: kurang -Rp 5.000 ⚠️"} {
		if !strings.Contains(msg, want) {
			t.Fatalf("message misses %q:\n%s", want, msg)
		}
	}
	if h.wa.sent[0].by != h.staff.UserID {
		t.Fatalf("sent by %q", h.wa.sent[0].by)
	}

	h.wa.fail["628123456789"] = "x"
	r = h.call("POST", "/api/pos/shifts/"+shiftID+"/send-report", nil, 200)
	if r.body["success"] != false || r.body["error"] != "Semua pengiriman gagal — cek gateway WA" {
		t.Fatalf("all failed = %s", r.raw)
	}
}
