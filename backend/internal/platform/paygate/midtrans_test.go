package paygate

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// stand-in records every Midtrans call and answers from a script.
type standIn struct {
	*httptest.Server
	calls   []call
	answers map[string]answer // "METHOD path" -> answer
}

type call struct {
	method, path, auth string
	body               map[string]any
}

type answer struct {
	status int
	body   map[string]any
}

func newStandIn(t *testing.T) *standIn {
	s := &standIn{answers: map[string]answer{}}
	s.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c := call{method: r.Method, path: r.URL.Path, auth: r.Header.Get("Authorization")}
		_ = json.NewDecoder(r.Body).Decode(&c.body)
		s.calls = append(s.calls, c)
		a, ok := s.answers[r.Method+" "+r.URL.Path]
		if !ok {
			w.WriteHeader(500)
			return
		}
		w.WriteHeader(a.status)
		_ = json.NewEncoder(w).Encode(a.body)
	}))
	t.Cleanup(s.Close)
	return s
}

func client(s *standIn, env map[string]string) *MidtransClient {
	return &MidtransClient{APIBase: s.URL, SnapBase: s.URL, Client: s.Client(),
		Getenv: func(k string) string { return env[k] }, Now: func() time.Time { return time.Date(2026, 10, 27, 10, 0, 0, 0, time.UTC) }}
}

var sandbox = &Config{Provider: Midtrans, Environment: "sandbox", SecretKey: "SB-Mid-server-test"}

func TestMidtransQRChargeShape(t *testing.T) {
	s := newStandIn(t)
	s.answers["POST /v2/charge"] = answer{201, map[string]any{
		"status_code": "201", "transaction_id": "tx-1", "order_id": "gymcp_abc", "transaction_status": "pending",
		"qr_string": "00020101QR", "expiry_time": "2026-10-27 17:30:00",
		"actions": []any{map[string]any{"name": "generate-qr-code", "method": "GET", "url": s.URL + "/v2/qris/tx-1/qr-code"}},
	}}
	qr, err := client(s, nil).CreateQR(context.Background(), sandbox, QRRequest{ReferenceID: "gymcp_abc", Amount: 300000.4, Description: "Paket Go", Expiry: 30 * time.Minute})
	if err != nil {
		t.Fatal(err)
	}
	if qr.ID != "tx-1" || qr.QRString != "00020101QR" || qr.ImageURL != s.URL+"/v2/qris/tx-1/qr-code" || qr.ExpiresAt != "2026-10-27T10:30:00Z" {
		t.Fatalf("qr = %+v", qr)
	}
	c := s.calls[0]
	if c.auth != "Basic U0ItTWlkLXNlcnZlci10ZXN0Og==" {
		t.Errorf("auth = %q", c.auth)
	}
	details := c.body["transaction_details"].(map[string]any)
	if c.body["payment_type"] != "qris" || details["order_id"] != "gymcp_abc" || details["gross_amount"] != 300000.0 ||
		c.body["qris"].(map[string]any)["acquirer"] != "gopay" {
		t.Errorf("charge body = %v", c.body)
	}
	if exp := c.body["custom_expiry"].(map[string]any); exp["expiry_duration"] != 30.0 || exp["unit"] != "minute" {
		t.Errorf("custom_expiry = %v", exp)
	}
	item := c.body["item_details"].([]any)[0].(map[string]any)
	if item["price"] != 300000.0 || item["quantity"] != 1.0 || item["name"] != "Paket Go" {
		t.Errorf("item = %v", item)
	}
}

func TestMidtransQRUnavailableAndErrors(t *testing.T) {
	s := newStandIn(t)
	s.answers["POST /v2/charge"] = answer{402, map[string]any{"status_code": "402", "status_message": "Payment type not enabled"}}
	_, err := client(s, nil).CreateQR(context.Background(), sandbox, QRRequest{ReferenceID: "r1", Amount: 1000})
	if !errors.Is(err, ErrQRUnavailable) {
		t.Fatalf("err = %v", err)
	}
	s.answers["POST /v2/charge"] = answer{200, map[string]any{"status_code": "406", "status_message": "duplicate order id"}}
	_, err = client(s, nil).CreateQR(context.Background(), sandbox, QRRequest{ReferenceID: "r1", Amount: 1000})
	if err == nil || !strings.Contains(err.Error(), "406") || !strings.Contains(err.Error(), "duplicate order id") {
		t.Fatalf("err = %v", err)
	}
	if _, err := client(s, nil).CreateQR(context.Background(), nil, QRRequest{ReferenceID: "r1", Amount: 1000}); err == nil {
		t.Fatal("nil config accepted")
	}
}

func TestMidtransSnapShape(t *testing.T) {
	s := newStandIn(t)
	s.answers["POST /snap/v1/transactions"] = answer{201, map[string]any{"token": "snap-tok", "redirect_url": "https://app.sandbox.midtrans.com/snap/v4/redirection/snap-tok"}}
	m := client(s, nil)
	h, err := m.CreateHosted(context.Background(), sandbox, HostedRequest{
		ReferenceID: "gymcp_inv", Amount: 1000000, Description: "Paket Bulanan", PayerName: "Budi", PayerEmail: "budi@example.test",
		RedirectURL: "https://app.example/member/wallet/pay/p1", Expiry: 2 * time.Hour,
	})
	if err != nil {
		t.Fatal(err)
	}
	if h.ID != "snap-tok" || h.URL != "https://app.sandbox.midtrans.com/snap/v4/redirection/snap-tok" || h.Mock || !h.ExpiresAt.Equal(m.now().Add(2*time.Hour)) {
		t.Fatalf("hosted = %+v", h)
	}
	c := s.calls[0]
	if c.body["callbacks"].(map[string]any)["finish"] != "https://app.example/member/wallet/pay/p1" ||
		c.body["expiry"].(map[string]any)["duration"] != 120.0 || c.body["expiry"].(map[string]any)["unit"] != "minutes" ||
		c.body["customer_details"].(map[string]any)["first_name"] != "Budi" || c.body["customer_details"].(map[string]any)["email"] != "budi@example.test" {
		t.Errorf("snap body = %v", c.body)
	}
	if _, has := c.body["payment_type"]; has {
		t.Error("snap request must not pick a payment type")
	}

	s.answers["POST /snap/v1/transactions"] = answer{401, map[string]any{"error_messages": []any{"Access denied due to unauthorized transaction, please check client key or server key"}}}
	if _, err := m.CreateHosted(context.Background(), sandbox, HostedRequest{ReferenceID: "x", Amount: 1}); err == nil || !strings.Contains(err.Error(), "Access denied") {
		t.Fatalf("err = %v", err)
	}
	if problem := m.HostedProblem(&Config{Provider: Xendit, SecretKey: "x"}); problem == "" {
		t.Error("a Xendit row must not serve Snap")
	}
}

func TestMidtransStatusAndCancel(t *testing.T) {
	s := newStandIn(t)
	m := client(s, nil)
	s.answers["GET /v2/gymcp_abc/status"] = answer{200, map[string]any{"status_code": "200", "transaction_id": "tx-1", "order_id": "gymcp_abc",
		"transaction_status": "settlement", "fraud_status": "accept", "gross_amount": "300000.00"}}
	st, err := m.Status(context.Background(), sandbox, Ref{ReferenceID: "gymcp_abc"})
	if err != nil || st.State != StatePaid || st.PaymentID != "tx-1" || st.Amount != 300000 || st.Raw != "settlement" {
		t.Fatalf("status = %+v %v", st, err)
	}
	s.answers["GET /v2/gymcp_new/status"] = answer{404, map[string]any{"status_code": "404", "status_message": "Transaction doesn't exist."}}
	st, err = m.Status(context.Background(), sandbox, Ref{ReferenceID: "gymcp_new"})
	if err != nil || st.State != StatePending {
		t.Fatalf("unknown transaction = %+v %v", st, err)
	}
	s.answers["GET /v2/gymcp_bad/status"] = answer{401, map[string]any{"status_code": "401", "status_message": "unauthorized"}}
	if _, err := m.Status(context.Background(), sandbox, Ref{ReferenceID: "gymcp_bad"}); err == nil {
		t.Fatal("401 must fail")
	}

	s.answers["POST /v2/gymcp_abc/cancel"] = answer{200, map[string]any{"status_code": "200", "transaction_status": "cancel"}}
	if err := m.Cancel(context.Background(), sandbox, Ref{ReferenceID: "gymcp_abc"}); err != nil {
		t.Fatal(err)
	}
	s.answers["POST /v2/gymcp_abc/cancel"] = answer{412, map[string]any{"status_code": "412", "status_message": "Merchant cannot modify the status of the transaction"}}
	if err := m.Cancel(context.Background(), sandbox, Ref{ReferenceID: "gymcp_abc"}); !errors.Is(err, ErrNotCancelable) {
		t.Fatalf("412 = %v", err)
	}
	s.answers["POST /v2/gymcp_abc/cancel"] = answer{404, map[string]any{"status_code": "404"}}
	if err := m.Cancel(context.Background(), sandbox, Ref{ReferenceID: "gymcp_abc"}); err != nil {
		t.Fatalf("404 = %v", err)
	}
	if s.calls[len(s.calls)-1].path != "/v2/gymcp_abc/cancel" {
		t.Errorf("path = %s", s.calls[len(s.calls)-1].path)
	}
}

func TestMidtransTestConnection(t *testing.T) {
	s := newStandIn(t)
	m := client(s, nil)
	s.Server.Config.Handler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, "/v2/nuhabit-ping-") || !strings.HasSuffix(r.URL.Path, "/status") {
			t.Errorf("probe path %s", r.URL.Path)
		}
		code := 404
		if r.Header.Get("Authorization") != "Basic U0ItTWlkLXNlcnZlci10ZXN0Og==" {
			code = 401
		}
		w.WriteHeader(code)
		_ = json.NewEncoder(w).Encode(map[string]any{"status_code": http.StatusText(code)})
	})
	if err := m.TestConnection(context.Background(), sandbox); err != nil {
		t.Fatalf("good key: %v", err)
	}
	err := m.TestConnection(context.Background(), &Config{Provider: Midtrans, SecretKey: "wrong"})
	if err == nil || !strings.Contains(err.Error(), "401") {
		t.Fatalf("bad key: %v", err)
	}
	if err := m.TestConnection(context.Background(), &Config{Provider: Midtrans}); err == nil {
		t.Fatal("empty key accepted")
	}
}

func TestMidtransMock(t *testing.T) {
	s := newStandIn(t)
	m := client(s, map[string]string{"MIDTRANS_MOCK": "1"})
	qr, err := m.CreateQR(context.Background(), nil, QRRequest{ReferenceID: "gymcp_m", Amount: 100})
	if err != nil || !strings.HasPrefix(qr.QRString, "MOCK-MIDTRANS-QRIS-") || qr.ExpiresAt != "2026-10-27T10:30:00Z" {
		t.Fatalf("mock qr = %+v %v", qr, err)
	}
	h, err := m.CreateHosted(context.Background(), nil, HostedRequest{ReferenceID: "gymcp_m", Amount: 100, RedirectURL: "https://app.example/pay/1"})
	if err != nil || !h.Mock || h.URL != "https://app.example/pay/1" {
		t.Fatalf("mock hosted = %+v %v", h, err)
	}
	st, err := m.Status(context.Background(), nil, Ref{ReferenceID: "gymcp_m"})
	if err != nil || st.State != StatePaid {
		t.Fatalf("mock status = %+v %v", st, err)
	}
	if m.HostedProblem(nil) != "" || m.Cancel(context.Background(), nil, Ref{}) != nil || len(s.calls) != 0 {
		t.Error("mock mode must not call the network")
	}
}

func TestMapState(t *testing.T) {
	cases := map[[2]string]State{
		{"settlement", "accept"}: StatePaid, {"settlement", ""}: StatePaid,
		{"capture", "accept"}: StatePaid, {"capture", ""}: StatePaid, {"capture", "challenge"}: StatePending, {"capture", "deny"}: StateFailed,
		{"pending", ""}: StatePending, {"authorize", ""}: StatePending,
		{"expire", ""}: StateExpired, {"cancel", ""}: StateCanceled, {"deny", ""}: StateFailed, {"failure", ""}: StateFailed,
		{"refund", ""}: StateRefunded, {"partial_refund", ""}: StateRefunded, {"chargeback", ""}: StateRefunded,
		{"SETTLEMENT ", "ACCEPT"}: StatePaid, {"", ""}: StatePending, {"something_new", ""}: StatePending,
	}
	for in, want := range cases {
		if got := MapState(in[0], in[1]); got != want {
			t.Errorf("MapState(%q, %q) = %s, want %s", in[0], in[1], got, want)
		}
	}
	if !StateExpired.Closed() || StatePending.Closed() || StatePaid.Closed() {
		t.Error("Closed()")
	}
}

func TestNotificationSignature(t *testing.T) {
	body := `{"transaction_time":"2026-10-27 17:00:00","transaction_status":"settlement","transaction_id":"tx-9","status_message":"midtrans payment notification",
		"status_code":"200","signature_key":"` + Sign("gymcp_abc", "200", "300000.00", "SB-Mid-server-test") + `","payment_type":"qris","order_id":"gymcp_abc",
		"merchant_id":"G1","gross_amount":"300000.00","fraud_status":"accept","currency":"IDR"}`
	n, ok := ParseNotification([]byte(body))
	if !ok || n.OrderID != "gymcp_abc" || n.TransactionID != "tx-9" || n.GrossAmount != "300000.00" || n.Amount() != 300000 || n.State() != StatePaid {
		t.Fatalf("parsed = %+v %v", n, ok)
	}
	if !n.Verify("SB-Mid-server-test") {
		t.Fatal("valid signature rejected")
	}
	if n.Verify("other-key") || n.Verify("") {
		t.Fatal("wrong key accepted")
	}
	upper := n
	upper.SignatureKey = strings.ToUpper(n.SignatureKey)
	if !upper.Verify("SB-Mid-server-test") {
		t.Fatal("upper-case hex rejected")
	}
	tampered := n
	tampered.GrossAmount = "3000.00"
	if tampered.Verify("SB-Mid-server-test") {
		t.Fatal("tampered amount accepted")
	}
	// A numeric gross_amount keeps its literal digits for the signature.
	numeric, ok := ParseNotification([]byte(`{"order_id":"o1","status_code":"200","gross_amount":300000.00,"signature_key":"` + Sign("o1", "200", "300000.00", "k") + `"}`))
	if !ok || numeric.GrossAmount != "300000.00" || !numeric.Verify("k") {
		t.Fatalf("numeric amount = %+v", numeric)
	}
	if _, ok := ParseNotification([]byte(`{"status_code":"200"}`)); ok {
		t.Fatal("missing order_id accepted")
	}
	if _, ok := ParseNotification([]byte(`bukan json`)); ok {
		t.Fatal("garbage accepted")
	}
	blank := Notification{OrderID: "o1", StatusCode: "200", GrossAmount: "1.00"}
	if blank.Verify("k") {
		t.Fatal("empty signature accepted")
	}
}

func TestMidtransHostsFollowEnvironment(t *testing.T) {
	m := &MidtransClient{}
	if m.apiBase(&Config{Environment: "live"}) != midtransAPILive || m.apiBase(&Config{Environment: "sandbox"}) != midtransAPISandbox ||
		m.snapBase(&Config{Environment: "live"}) != midtransSnapLive || m.snapBase(&Config{}) != midtransSnapSandbox {
		t.Fatal("hosts")
	}
	if midtransTime("not a time") != "" || midtransTime("") != "" {
		t.Fatal("bad times must be empty")
	}
}

func TestCaps(t *testing.T) {
	if c := Caps(nil, true); c.Active || c.SavedMethods || c.Provider != Xendit {
		t.Fatalf("no row = %+v", c)
	}
	if c := Caps(&Config{Provider: Midtrans}, true); !c.Active || c.SavedMethods || c.Provider != Midtrans {
		t.Fatalf("midtrans = %+v", c)
	}
	if c := Caps(&Config{Provider: Xendit}, true); !c.SavedMethods {
		t.Fatalf("xendit = %+v", c)
	}
}
