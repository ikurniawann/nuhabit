package webhooks

import (
	"net/http/httptest"
	"testing"

	"nuhabit/backend/internal/platform/paygate"
)

/* ── Midtrans (POST /api/payments/midtrans/webhook) ──────────────────── */

const midtransServerKey = "SB-Mid-server-test-key"

func (f *fixture) midtransGateway(active bool) {
	f.exec(`INSERT INTO configuration.payment_gateways (provider, display_name, is_active, environment, secret_key, public_key)
		VALUES ('midtrans', 'Midtrans', $1, 'sandbox', $2, 'SB-Mid-client-test')
		ON CONFLICT (provider) DO UPDATE SET is_active = EXCLUDED.is_active, secret_key = EXCLUDED.secret_key, public_key = EXCLUDED.public_key`,
		active, midtransServerKey)
}

// notification is a signed Midtrans body; key "" keeps the right key.
func notification(orderID, status, fraud, amount, key string) string {
	if key == "" {
		key = midtransServerKey
	}
	return `{"transaction_time":"2026-10-27 17:00:00","transaction_status":"` + status + `","transaction_id":"mt-tx-1","status_message":"midtrans payment notification",
		"status_code":"200","signature_key":"` + paygate.Sign(orderID, "200", amount, key) + `","payment_type":"qris","order_id":"` + orderID + `",
		"merchant_id":"G123","gross_amount":"` + amount + `","fraud_status":"` + fraud + `","currency":"IDR"}`
}

func (f *fixture) midtrans(body string) response {
	return f.post("/api/payments/midtrans/webhook", body, map[string]string{"Content-Type": "application/json"})
}

func TestMidtransAuthAndConfig(t *testing.T) {
	f := newFixture(t)
	f.exec(`DELETE FROM configuration.payment_gateways WHERE provider = 'midtrans'`)
	expect(t, f.midtrans(notification("topup_a", "settlement", "accept", "50000.00", "")), 200,
		`{"success":true,"ignored":true,"reason":"midtrans_not_configured"}`)

	f.midtransGateway(true)
	f.pay.topups["reference_id=topup_a"] = &Pending{ID: "tx-1", Amount: "50000"}
	expect(t, f.midtrans(notification("topup_a", "settlement", "accept", "50000.00", "wrong-key")), 401, `{"success":false,"error":"Invalid signature"}`)
	// A tampered amount no longer matches the signature.
	tampered := `{"order_id":"topup_a","status_code":"200","gross_amount":"1.00","transaction_status":"settlement","signature_key":"` +
		paygate.Sign("topup_a", "200", "50000.00", midtransServerKey) + `"}`
	expect(t, f.midtrans(tampered), 401, `{"success":false,"error":"Invalid signature"}`)
	expect(t, f.midtrans(`{"transaction_status":"settlement"}`), 200, `{"success":true,"ignored":true,"reason":"invalid_body"}`)
	expect(t, f.midtrans("bukan json"), 200, `{"success":true,"ignored":true,"reason":"invalid_body"}`)
	expect(t, f.midtrans(notification("topup_a", "pending", "", "50000.00", "")), 200, `{"success":true,"ignored":true,"reason":"not_paid","status":"PENDING"}`)
	expect(t, f.midtrans(notification("topup_a", "capture", "challenge", "50000.00", "")), 200, `{"success":true,"ignored":true,"reason":"not_paid","status":"CAPTURE"}`)
	if len(f.published()) != 0 || len(f.pay.settled) != 0 {
		t.Error("nothing may be settled before the signature check")
	}
	r := httptest.NewRecorder()
	f.mux.ServeHTTP(r, httptest.NewRequest("GET", "/api/payments/midtrans/webhook", nil))
	if r.Body.String() != `{"success":true,"service":"midtrans-webhook"}` {
		t.Errorf("probe = %s", r.Body.String())
	}
}

func TestMidtransSettlements(t *testing.T) {
	f := newFixture(t)
	// An inactive row still verifies: payments started before a gateway
	// switch settle.
	f.midtransGateway(false)

	// Gym purchase: amount mismatch, settlement, then expire and deny close it.
	f.pay.gym = &Pending{ID: "gp-1", Amount: "300000.00"}
	expect(t, f.midtrans(notification("gymcp_abc", "settlement", "accept", "3000.00", "")), 200, `{"success":true,"ignored":true,"reason":"amount_mismatch"}`)
	expect(t, f.midtrans(notification("gymcp_abc", "settlement", "accept", "300000.00", "")), 200,
		`{"success":true,"data":{"gym_purchase":{"purchase_id":"gp-1","status":"paid"}}}`)
	expect(t, f.midtrans(notification("gymcp_abc", "capture", "accept", "300000.00", "")), 200,
		`{"success":true,"data":{"gym_purchase":{"purchase_id":"gp-1","status":"paid"}}}`)
	if len(f.pay.settled) != 2 || f.pay.settled[0] != "gymcp_abc/mt-tx-1" {
		t.Errorf("settled = %v", f.pay.settled)
	}
	expect(t, f.midtrans(notification("gymcp_abc", "expire", "", "300000.00", "")), 200,
		`{"success":true,"data":{"gym_purchase":{"purchase_id":"gp-1","status":"expired"}}}`)
	expect(t, f.midtrans(notification("gymcp_abc", "cancel", "", "300000.00", "")), 200,
		`{"success":true,"data":{"gym_purchase":{"purchase_id":"gp-1","status":"expired"}}}`)
	expect(t, f.midtrans(notification("gymcp_abc", "deny", "", "300000.00", "")), 200,
		`{"success":true,"data":{"gym_purchase":{"purchase_id":"gp-1","status":"failed"}}}`)
	expect(t, f.midtrans(notification("gymcp_abc", "refund", "", "300000.00", "")), 200, `{"success":true,"ignored":true,"reason":"not_paid","status":"REFUND"}`)
	if len(f.pay.closed) != 3 || f.pay.closed[0] != "gymcp_abc/expired" || f.pay.closed[2] != "gymcp_abc/failed" {
		t.Errorf("closed = %v", f.pay.closed)
	}

	// A top-up by merchant reference goes through the same outbox path as Xendit.
	f.pay.topups["reference_id=topup_m"] = &Pending{ID: "tx-9", Amount: "50000.00"}
	expect(t, f.midtrans(notification("topup_m", "settlement", "accept", "50000.00", "")), 200, `{"success":true,"queued":true,"data":{"topup_id":"tx-9"}}`)
	ev := f.published()
	if len(ev) != 1 || ev[0].Action != "credit_topup" || ev[0].TargetID != "tx-9" || ev[0].QRID != "mt-tx-1" || ev[0].PaymentID != "mt-tx-1" ||
		ev[0].Amount != 50000 || ev[0].ReferenceID != "topup_m" {
		t.Fatalf("events = %+v", ev)
	}
	expect(t, f.midtrans(notification("unknown-order", "settlement", "accept", "1.00", "")), 200, `{"success":true,"ignored":true,"reason":"topup_not_found"}`)
	// An expired POS payment is nothing to settle.
	expect(t, f.midtrans(notification("topup_m", "expire", "", "50000.00", "")), 200, `{"success":true,"ignored":true,"reason":"not_paid","status":"EXPIRE"}`)
}
