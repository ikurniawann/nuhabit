package gymcredits

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

// midtransStandIn plays api.sandbox.midtrans.com and app.sandbox.midtrans.com
// for one order at a time.
type midtransStandIn struct {
	*httptest.Server
	mu sync.Mutex
	// qrisEnabled false answers /v2/charge with 402 (no QRIS channel).
	qrisEnabled bool
	// status is what /v2/{order}/status reports; canceled records cancels.
	status   string
	canceled []string
	charges  []map[string]any
	snaps    []map[string]any
}

func newMidtransStandIn(t *testing.T) *midtransStandIn {
	s := &midtransStandIn{qrisEnabled: true, status: "pending"}
	s.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		s.mu.Lock()
		defer s.mu.Unlock()
		if r.Header.Get("Authorization") != "Basic U0ItTWlkLXNlcnZlci10ZXN0Og==" {
			w.WriteHeader(401)
			_ = json.NewEncoder(w).Encode(map[string]any{"status_code": "401"})
			return
		}
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		switch {
		case r.Method == "POST" && r.URL.Path == "/v2/charge":
			s.charges = append(s.charges, body)
			if !s.qrisEnabled {
				w.WriteHeader(402)
				_ = json.NewEncoder(w).Encode(map[string]any{"status_code": "402", "status_message": "Payment type not enabled"})
				return
			}
			order := body["transaction_details"].(map[string]any)["order_id"]
			w.WriteHeader(201)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"status_code": "201", "transaction_id": "mt-tx-1", "order_id": order, "transaction_status": "pending",
				"qr_string": "00020101MIDTRANS", "expiry_time": "2030-01-01 10:00:00",
				"actions": []any{map[string]any{"name": "generate-qr-code", "method": "GET", "url": "https://api.sandbox.midtrans.com/v2/qris/mt-tx-1/qr-code"}},
			})
		case r.Method == "POST" && r.URL.Path == "/snap/v1/transactions":
			s.snaps = append(s.snaps, body)
			w.WriteHeader(201)
			_ = json.NewEncoder(w).Encode(map[string]any{"token": "snap-tok-1", "redirect_url": "https://app.sandbox.midtrans.com/snap/v4/redirection/snap-tok-1"})
		case r.Method == "GET" && strings.HasSuffix(r.URL.Path, "/status"):
			_ = json.NewEncoder(w).Encode(map[string]any{"status_code": "200", "transaction_id": "mt-tx-1", "transaction_status": s.status,
				"fraud_status": "accept", "gross_amount": "300000.00"})
		case r.Method == "POST" && strings.HasSuffix(r.URL.Path, "/cancel"):
			s.canceled = append(s.canceled, strings.TrimSuffix(strings.TrimPrefix(r.URL.Path, "/v2/"), "/cancel"))
			if s.status != "pending" {
				w.WriteHeader(412)
				_ = json.NewEncoder(w).Encode(map[string]any{"status_code": "412"})
				return
			}
			s.status = "cancel"
			_ = json.NewEncoder(w).Encode(map[string]any{"status_code": "200", "transaction_status": "cancel"})
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(s.Close)
	return s
}

func (e *env) activateMidtrans() {
	e.t.Helper()
	e.exec(`DELETE FROM configuration.payment_gateways WHERE provider = 'xendit'`)
	e.exec(`INSERT INTO configuration.payment_gateways (provider, display_name, is_active, environment, secret_key, public_key, metadata)
		VALUES ('midtrans', 'Midtrans', true, 'sandbox', 'SB-Mid-server-test', 'SB-Mid-client-test', '{"merchant_id":"G1"}')
		ON CONFLICT (provider) DO UPDATE SET is_active = true, environment = 'sandbox', secret_key = 'SB-Mid-server-test', public_key = 'SB-Mid-client-test'`)
}

func TestMidtransPurchases(t *testing.T) {
	mt := newMidtransStandIn(t)
	t.Setenv("MIDTRANS_API_BASE_URL", mt.URL)
	t.Setenv("MIDTRANS_SNAP_BASE_URL", mt.URL)
	t.Setenv("MIDTRANS_MOCK", "")
	t.Setenv("XENDIT_SECRET_KEY", "")
	t.Setenv("XENDIT_MOCK", "")
	t.Setenv("MEMBER_OTP_DEV_CODE", "")
	t.Setenv(SavedMethodsFlag, "1")
	e := setup(t)
	e.activateMidtrans()
	pkg := e.pkg("Go Midtrans", 3, 300_000, 30, nil)

	// The member app learns the active gateway; saved methods are Xendit-only.
	list := e.data(asMember, "GET", "/api/member-portal/gym/credits/packages", nil)
	if caps, _ := list["gateway"].(map[string]any); caps["provider"] != "midtrans" || caps["active"] != true || caps["saved_methods"] != false {
		t.Fatalf("gateway caps %v", list["gateway"])
	}
	if methods := e.data(asMember, "GET", "/api/member-portal/gym/payment-methods", nil); methods["enabled"] != false {
		t.Fatalf("saved methods must be off under Midtrans: %v", methods)
	}

	// QRIS through the Core API: the QR string and image, polled to settlement.
	pending := e.data(asMember, "POST", "/api/member-portal/gym/credits/purchases", map[string]any{"package_id": pkg, "method": "qris"})
	if pending["status"] != "pending" || pending["qr_string"] != "00020101MIDTRANS" || pending["gateway"] != "midtrans" ||
		pending["qr_image_url"] != "https://api.sandbox.midtrans.com/v2/qris/mt-tx-1/qr-code" || pending["expires_at"] != "2030-01-01T03:00:00Z" ||
		pending["simulated"] != false || pending["invoice_url"] != nil {
		t.Fatalf("qris purchase %v", pending)
	}
	charge := mt.charges[0]
	var external string
	e.scalar(&external, `SELECT external_id FROM gym.credit_purchases WHERE id = $1`, pending["id"])
	if charge["payment_type"] != "qris" || charge["transaction_details"].(map[string]any)["order_id"] != external ||
		charge["transaction_details"].(map[string]any)["gross_amount"] != 300000.0 {
		t.Fatalf("charge body %v", charge)
	}
	still := e.data(asMember, "GET", "/api/member-portal/gym/credits/purchases/"+pending["id"].(string), nil)
	if still["status"] != "pending" {
		t.Fatalf("status while pending %v", still)
	}
	mt.mu.Lock()
	mt.status = "settlement"
	mt.mu.Unlock()
	paid := e.data(asMember, "GET", "/api/member-portal/gym/credits/purchases/"+pending["id"].(string), nil)
	if paid["status"] != "paid" || paid["qr_string"] != nil {
		t.Fatalf("status after settlement %v", paid)
	}
	var meta map[string]any
	var rawMeta []byte
	e.scalar(&rawMeta, `SELECT payment_meta FROM gym.credit_purchases WHERE id = $1`, pending["id"])
	_ = json.Unmarshal(rawMeta, &meta)
	if meta["gateway_payment_id"] != "mt-tx-1" || meta["reconciled"] != true || meta["gateway"] != "midtrans" {
		t.Fatalf("meta %v", meta)
	}
	if b := e.balance(); b != 3 {
		t.Fatalf("credits %d", b)
	}

	// No QRIS channel: the QR purchase falls back to a Snap page.
	mt.mu.Lock()
	mt.qrisEnabled, mt.status = false, "pending"
	mt.mu.Unlock()
	t.Setenv("NEXT_PUBLIC_APP_URL", "https://app.example.test")
	fallback := e.data(asMember, "POST", "/api/member-portal/gym/credits/purchases", map[string]any{"package_id": pkg, "method": "qris"})
	if fallback["status"] != "pending" || fallback["qr_string"] != nil || fallback["invoice_url"] != "https://app.sandbox.midtrans.com/snap/v4/redirection/snap-tok-1" ||
		fallback["gateway"] != "midtrans" {
		t.Fatalf("snap fallback %v", fallback)
	}
	snap := mt.snaps[0]
	if snap["callbacks"].(map[string]any)["finish"] != "https://app.example.test/member/wallet/pay/"+fallback["id"].(string) {
		t.Fatalf("snap finish url %v", snap["callbacks"])
	}

	// Hosted checkout on request (the public site and auto-renew use it).
	hosted := e.data(asMember, "POST", "/api/member-portal/gym/credits/purchases", map[string]any{"package_id": pkg, "method": "invoice", "source": "site"})
	if hosted["invoice_url"] != "https://app.sandbox.midtrans.com/snap/v4/redirection/snap-tok-1" || hosted["payment_method"] != "invoice" {
		t.Fatalf("hosted purchase %v", hosted)
	}
	if finish := mt.snaps[1]["callbacks"].(map[string]any)["finish"].(string); !strings.HasSuffix(finish, "/join/status?purchase="+hosted["id"].(string)) {
		t.Fatalf("hosted finish url %s", finish)
	}

	// Expiry cancels at Midtrans first; a transaction it can no longer
	// cancel is re-read and, when paid meanwhile, settled.
	e.exec(`UPDATE gym.credit_purchases SET payment_meta = payment_meta || '{"expires_at":"2020-01-01T00:00:00Z"}', created_at = now() - interval '5 minutes' WHERE id = $1`, fallback["id"])
	e.exec(`UPDATE gym.credit_purchases SET payment_meta = payment_meta || '{"expires_at":"2020-01-01T00:00:00Z"}', created_at = now() - interval '5 minutes' WHERE id = $1`, hosted["id"])
	mt.mu.Lock()
	mt.status = "settlement" // hosted and fallback share the stand-in's one status: cancel answers 412
	mt.mu.Unlock()
	if err := e.svc.ReconcilePendingPurchases(e.ctx, time.Now()); err != nil {
		t.Fatal(err)
	}
	for _, id := range []any{fallback["id"], hosted["id"]} {
		var status string
		e.scalar(&status, `SELECT status FROM gym.credit_purchases WHERE id = $1`, id)
		if status != "paid" {
			t.Fatalf("purchase %v after late settlement: %s", id, status)
		}
	}
	if len(mt.canceled) != 0 {
		// Status is read first and settles; cancel is for the pending case below.
		t.Fatalf("cancel called before status: %v", mt.canceled)
	}
	mt.mu.Lock()
	mt.status = "pending"
	mt.mu.Unlock()
	stale := e.data(asMember, "POST", "/api/member-portal/gym/credits/purchases", map[string]any{"package_id": pkg, "method": "invoice"})
	e.exec(`UPDATE gym.credit_purchases SET payment_meta = payment_meta || '{"expires_at":"2020-01-01T00:00:00Z"}', created_at = now() - interval '5 minutes' WHERE id = $1`, stale["id"])
	if err := e.svc.ReconcilePendingPurchases(e.ctx, time.Now()); err != nil {
		t.Fatal(err)
	}
	var staleStatus, staleRef string
	e.scalar(&staleStatus, `SELECT status FROM gym.credit_purchases WHERE id = $1`, stale["id"])
	e.scalar(&staleRef, `SELECT external_id FROM gym.credit_purchases WHERE id = $1`, stale["id"])
	if staleStatus != "expired" || len(mt.canceled) != 1 || mt.canceled[0] != staleRef {
		t.Fatalf("stale: status %s canceled %v (ref %s)", staleStatus, mt.canceled, staleRef)
	}

	// The webhook settles by reference, idempotently, through the same path.
	res, err := e.svc.SettleByReference(e.ctx, external, nil)
	if err != nil || res.Status != "already_paid" {
		t.Fatalf("settle %+v %v", res, err)
	}
	closed, err := e.svc.CloseByReference(e.ctx, staleRef, "failed")
	if err != nil || closed.Status != "expired" {
		t.Fatalf("close of a closed purchase %+v %v", closed, err)
	}
}

// MIDTRANS_MOCK=1 is the local-dev rail: no network, the first poll settles.
func TestMidtransMockMode(t *testing.T) {
	t.Setenv("MIDTRANS_MOCK", "1")
	t.Setenv("MIDTRANS_API_BASE_URL", "http://127.0.0.1:9")
	t.Setenv("MIDTRANS_SNAP_BASE_URL", "http://127.0.0.1:9")
	t.Setenv("MEMBER_OTP_DEV_CODE", "123456")
	e := setup(t)
	e.activateMidtrans()
	pkg := e.pkg("Go Midtrans Mock", 2, 100_000, 30, nil)

	pending := e.data(asMember, "POST", "/api/member-portal/gym/credits/purchases", map[string]any{"package_id": pkg, "method": "qris"})
	if pending["status"] != "pending" || !strings.HasPrefix(pending["qr_string"].(string), "MOCK-MIDTRANS-QRIS-gymcp_") || pending["gateway"] != "midtrans" {
		t.Fatalf("mock qris %v", pending)
	}
	if !e.svc.CanSimulate() {
		t.Skip("TEST_DATABASE_URL is not local; dev bypass inactive")
	}
	paid := e.data(asMember, "POST", "/api/member-portal/gym/credits/purchases/"+pending["id"].(string)+"/simulate-paid", nil)
	if paid["status"] != "paid" {
		t.Fatalf("simulate-paid %v", paid)
	}
	hosted := e.data(asMember, "POST", "/api/member-portal/gym/credits/purchases", map[string]any{"package_id": pkg, "method": "invoice"})
	if hosted["simulated"] != true || !strings.HasSuffix(hosted["invoice_url"].(string), "/member/wallet/pay/"+hosted["id"].(string)) {
		t.Fatalf("mock hosted %v", hosted)
	}
	if polled := e.data(asMember, "GET", "/api/member-portal/gym/credits/purchases/"+hosted["id"].(string), nil); polled["status"] != "paid" {
		t.Fatalf("mock poll %v", polled)
	}
	if b := e.balance(); b != 4 {
		t.Fatalf("credits %d", b)
	}
}
