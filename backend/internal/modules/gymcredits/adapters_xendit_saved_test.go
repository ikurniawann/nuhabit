package gymcredits

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// The saved-method calls against a local stand-in for api.xendit.co.
func TestXenditSavedMethodRequests(t *testing.T) {
	type call struct {
		method, path, version, idempotency string
		body                               map[string]any
	}
	var calls []call
	replies := map[string]struct {
		status int
		body   string
	}{
		"POST /sessions":              {201, `{"payment_session_id":"ps-1","payment_link_url":"https://xen.to/x","status":"ACTIVE","customer_id":"cust-1"}`},
		"GET /sessions/ps-1":          {200, `{"payment_session_id":"ps-1","status":"COMPLETED","payment_token_id":"pt-1"}`},
		"GET /v3/payment_tokens/pt-1": {200, `{"payment_token_id":"pt-1","status":"ACTIVE","channel_code":"OVO"}`},
		"POST /v3/payment_requests":   {201, `{"payment_request_id":"pr-1","status":"SUCCEEDED"}`},
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c := call{method: r.Method, path: r.URL.Path, version: r.Header.Get("api-version"), idempotency: r.Header.Get("idempotency-key")}
		_ = json.NewDecoder(r.Body).Decode(&c.body)
		calls = append(calls, c)
		if user, _, ok := r.BasicAuth(); !ok || user != "xnd_test" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		reply, ok := replies[r.Method+" "+r.URL.Path]
		if !ok {
			reply.status, reply.body = 400, `{"error_code":"INVALID_TOKEN","message":"token expired"}`
		}
		w.WriteHeader(reply.status)
		_, _ = w.Write([]byte(reply.body))
	}))
	defer srv.Close()
	g := &XenditGateway{BaseURL: srv.URL, Client: srv.Client()}
	cfg := &XenditConfig{SecretKey: "xnd_test"}
	ctx := context.Background()

	session, err := g.StartLink(ctx, cfg, LinkRequest{ReferenceID: "gympm_1", Customer: LinkCustomer{ReferenceID: "c1", GivenNames: "Ayu", Mobile: "+628123456789"},
		SuccessURL: "https://app.test/ok", CancelURL: "https://app.test/no", Channels: []string{"CARDS", "OVO"}})
	if err != nil || session.URL != "https://xen.to/x" || session.CustomerID != "cust-1" {
		t.Fatalf("start link %+v %v", session, err)
	}
	body := calls[0].body
	if body["session_type"] != "SAVE" || body["mode"] != "PAYMENT_LINK" || body["amount"] != 0.0 || calls[0].version != "" {
		t.Errorf("session body %v version %q", body, calls[0].version)
	}
	if customer, _ := body["customer"].(map[string]any); customer["reference_id"] != "c1" || customer["mobile_number"] != "+628123456789" {
		t.Errorf("customer %v", body["customer"])
	}
	// A returning member reuses the Xendit customer.
	if _, err := g.StartLink(ctx, cfg, LinkRequest{ReferenceID: "gympm_2", XenditCustomerID: "cust-1", SuccessURL: "https://app.test/ok"}); err != nil {
		t.Fatal(err)
	}
	if calls[1].body["customer_id"] != "cust-1" || calls[1].body["customer"] != nil {
		t.Errorf("second link body %v", calls[1].body)
	}

	if s, err := g.LinkStatus(ctx, cfg, "ps-1"); err != nil || s.Status != "COMPLETED" || s.TokenID != "pt-1" {
		t.Fatalf("link status %+v %v", s, err)
	}
	if tok, err := g.Token(ctx, cfg, "pt-1"); err != nil || tok.Type != "ewallet" || tok.Label != "OVO" || calls[3].version != paymentsAPIVersion {
		t.Fatalf("token %+v %v", tok, err)
	}

	c, err := g.Charge(ctx, cfg, ChargeRequest{ReferenceID: "gymcp_1", TokenID: "pt-1", ChannelCode: "CARDS", Amount: 150000.4, Description: "Paket"})
	if err != nil || c.ID != "pr-1" || c.Status != "SUCCEEDED" {
		t.Fatalf("charge %+v %v", c, err)
	}
	charge := calls[4]
	if charge.idempotency != "gymcp_1" || charge.version != paymentsAPIVersion || charge.body["type"] != "PAY" ||
		charge.body["request_amount"] != 150000.0 || charge.body["payment_token_id"] != "pt-1" || charge.body["channel_code"] != nil {
		t.Errorf("charge request %+v", charge)
	}
	// A 4xx is a declined charge; INVALID_TOKEN means the token is gone.
	g.BaseURL = srv.URL + "/gone"
	c, err = g.Charge(ctx, cfg, ChargeRequest{ReferenceID: "gymcp_2", TokenID: "pt-1"})
	if err != nil || c.Status != "FAILED" || c.FailureCode != "INVALID_TOKEN" || !c.TokenInvalid {
		t.Fatalf("declined %+v %v", c, err)
	}
}

func TestMethodLabelAndPhone(t *testing.T) {
	card := TokenFromPayload(map[string]any{"channel_code": "CARDS", "channel_properties": map[string]any{
		"card_details": map[string]any{"network": "mastercard", "masked_card_number": "520000XXXXXX1005", "cardholder_email": "x@y.z"},
	}})
	if card.Type != "card" || card.Label != "MASTERCARD •••• 1005" {
		t.Errorf("card %+v", card)
	}
	for channel, want := range map[string]string{"SHOPEEPAY": "ShopeePay", "DANA": "DANA", "": "Metode tersimpan", "NEWPAY": "NEWPAY"} {
		if _, label := methodLabel(channel, nil); label != want {
			t.Errorf("%q label %q", channel, label)
		}
	}
	for in, want := range map[string]string{
		"081234567890": "+6281234567890", "+62 812-3456-7890": "+6281234567890", "6281234567": "+6281234567",
		"12345": "", "+1 415 555 0100": "", "08abc": "",
	} {
		if got := e164(in); got != want {
			t.Errorf("e164(%q) = %q, want %q", in, got, want)
		}
	}
	if maskID("pt-1402feb0-bb79-47ae") != "pt-1402f…" || maskID("short") != "…" {
		t.Error("maskID")
	}
}
