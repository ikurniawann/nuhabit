package gymcredits

import (
	"context"
	"errors"
	"strconv"
	"strings"
	"testing"
	"time"
)

// Saved payment methods and renewal retries against TEST_DATABASE_URL, on a
// fake Xendit (no network). Helpers come from the other integration tests.

// fakeSaved is the saved-method gateway: links complete with a VISA card,
// charges end with outcome.
type fakeSaved struct {
	outcome      string // SUCCEEDED | FAILED | PENDING
	tokenInvalid bool
	charges      []ChargeRequest
	canceled     []string
}

const fakeToken = "pt-0b1c2d3e-test-token-0001"

func (f *fakeSaved) StartLink(_ context.Context, cfg *XenditConfig, in LinkRequest) (*LinkSession, error) {
	if cfg == nil || !strings.HasPrefix(in.ReferenceID, PaymentMethodRefPrefix) || in.SuccessURL == "" {
		return nil, errors.New("bad link request")
	}
	return &LinkSession{ID: "ps-test-" + in.ReferenceID, URL: "https://checkout-staging.xendit.co/sessions/ps-test", Status: "ACTIVE", CustomerID: "cust-test"}, nil
}

func (f *fakeSaved) LinkStatus(_ context.Context, _ *XenditConfig, sessionID string) (*LinkSession, error) {
	return &LinkSession{ID: sessionID, Status: "COMPLETED", TokenID: fakeToken}, nil
}

func (f *fakeSaved) Token(_ context.Context, _ *XenditConfig, tokenID string) (*SavedToken, error) {
	return TokenFromPayload(map[string]any{
		"payment_token_id": tokenID, "status": "ACTIVE", "channel_code": "CARDS",
		"channel_properties": map[string]any{"card_details": map[string]any{"network": "VISA", "masked_card_number": "520000******1005"}},
	}), nil
}

func (f *fakeSaved) CancelToken(_ context.Context, _ *XenditConfig, tokenID string) error {
	f.canceled = append(f.canceled, tokenID)
	return nil
}

func (f *fakeSaved) Charge(_ context.Context, _ *XenditConfig, in ChargeRequest) (*Charge, error) {
	f.charges = append(f.charges, in)
	c := &Charge{ID: "pr-test-" + strconv.Itoa(len(f.charges)), Status: f.outcome}
	if f.outcome == "FAILED" {
		c.FailureCode = "INSUFFICIENT_BALANCE"
	}
	if f.tokenInvalid {
		c = &Charge{Status: "FAILED", FailureCode: "INVALID_TOKEN", TokenInvalid: true}
	}
	return c, nil
}

func (f *fakeSaved) CancelCharge(_ context.Context, _ *XenditConfig, requestID string) error {
	f.canceled = append(f.canceled, requestID)
	return nil
}

func (f *fakeSaved) ChargeStatus(_ context.Context, _ *XenditConfig, requestID string) (*Charge, error) {
	return &Charge{ID: requestID, Status: f.outcome}, nil
}

// savedSetup turns saved methods on with an active gateway and the fake.
func savedSetup(t *testing.T) (*env, *fakeSaved) {
	t.Setenv(SavedMethodsFlag, "1")
	t.Setenv("NEXT_PUBLIC_APP_URL", "https://app.example.test")
	t.Setenv("XENDIT_SECRET_KEY", "")
	t.Setenv("XENDIT_MOCK", "1")
	e := setup(t)
	gw := &fakeSaved{outcome: "SUCCEEDED"}
	e.svc.ports.Gateway, e.svc.ports.SavedMethods = paidQR{}, gw
	return e, gw
}

// link links the fake card for the member through the API and the
// completed-session webhook; it returns the method id.
func (e *env) link() string {
	e.t.Helper()
	started := e.data(asMember, "POST", "/api/member-portal/gym/payment-methods", nil)
	method, _ := started["method"].(map[string]any)
	id, _ := method["id"].(string)
	if method["status"] != "pending" || started["redirect_url"] != "https://checkout-staging.xendit.co/sessions/ps-test" {
		e.t.Fatalf("link start %v", started)
	}
	var ref, session string
	e.scalar(&ref, `SELECT link_reference FROM gym.member_payment_methods WHERE id = $1`, id)
	e.scalar(&session, `SELECT session_id FROM gym.member_payment_methods WHERE id = $1`, id)
	res, err := e.svc.HandleGatewayEvent(e.ctx, GatewayEvent{Event: "payment_session.completed", ReferenceID: ref, SessionID: session, Status: "COMPLETED"})
	if err != nil || res.Status != "linked" {
		e.t.Fatalf("session webhook %+v %v", res, err)
	}
	return id
}

func (e *env) passState(id string) (autoRenew bool, renewWith string, attempts int, retryAt *time.Time, offReason *string) {
	e.t.Helper()
	err := e.tx.QueryRow(e.ctx, `SELECT auto_renew, renew_with, renewal_attempts, renewal_retry_at, auto_renew_off_reason
		FROM gym.member_passes WHERE id = $1`, id).Scan(&autoRenew, &renewWith, &attempts, &retryAt, &offReason)
	if err != nil {
		e.t.Fatal(err)
	}
	return
}

func (e *env) sweep(at time.Time) error {
	e.t.Helper()
	e.at(at, 0)
	return e.svc.SweepRenewals(e.ctx, at)
}

func TestSavedMethodLinkAndCharge(t *testing.T) {
	e, gw := savedSetup(t)
	c := e.member.CustomerID
	pkg := e.passPkg("Go Pass Saved", 900_000, 28)
	pass := e.passOf(e.buy(pkg).ID)
	path := "/api/member-portal/gym/passes/" + pass.ID + "/auto-renew"

	// Off by flag: the screen says so and linking is refused.
	t.Setenv(SavedMethodsFlag, "")
	if got := e.data(asMember, "GET", "/api/member-portal/gym/payment-methods", nil); got["enabled"] != false {
		t.Fatalf("flag off %v", got)
	}
	e.fail(asMember, "POST", "/api/member-portal/gym/payment-methods", nil, 503, "Metode pembayaran tersimpan belum tersedia")
	t.Setenv(SavedMethodsFlag, "1")

	// No method yet: saved_method is refused.
	e.fail(asMember, "PUT", path, map[string]any{"auto_renew": true, "renew_with": "saved_method"}, 409,
		"Tautkan kartu atau e-wallet dulu di menu Metode pembayaran")

	id := e.link()
	list := e.data(asMember, "GET", "/api/member-portal/gym/payment-methods", nil)
	methods, _ := list["methods"].([]any)
	if list["enabled"] != true || len(methods) != 1 {
		t.Fatalf("methods %v", list)
	}
	m := methods[0].(map[string]any)
	if m["id"] != id || m["status"] != "active" || m["label"] != "VISA •••• 1005" || m["type"] != "card" {
		t.Fatalf("method %v", m)
	}
	// Only the token id, channel and masked label are stored.
	var token, label string
	e.scalar(&token, `SELECT token_id FROM gym.member_payment_methods WHERE id = $1`, id)
	e.scalar(&label, `SELECT label FROM gym.member_payment_methods WHERE id = $1`, id)
	if token != fakeToken || strings.Contains(label, "520000") {
		t.Fatalf("stored %q %q", token, label)
	}
	e.fail(asMember, "POST", "/api/member-portal/gym/payment-methods", nil, 409,
		"Hapus metode pembayaran yang tersimpan dulu sebelum menautkan yang baru")
	// A replayed completed session changes nothing.
	var ref, session string
	e.scalar(&ref, `SELECT link_reference FROM gym.member_payment_methods WHERE id = $1`, id)
	e.scalar(&session, `SELECT session_id FROM gym.member_payment_methods WHERE id = $1`, id)
	if res, err := e.svc.HandleGatewayEvent(e.ctx, GatewayEvent{Event: "payment_session.completed", ReferenceID: ref, SessionID: "ps-forged"}); err != nil || res.Status != "ignored" {
		t.Fatalf("forged session %+v %v", res, err)
	}

	on := e.data(asMember, "PUT", path, map[string]any{"auto_renew": true, "renew_with": "saved_method"})
	if on["renew_with"] != "saved_method" {
		t.Fatalf("auto-renew %v", on)
	}

	// Inside the window the saved card pays without the member.
	if err := e.sweep(pass.EndsAt.Add(-2 * day)); err != nil {
		t.Fatal(err)
	}
	if len(gw.charges) != 1 || gw.charges[0].TokenID != fakeToken || gw.charges[0].Amount != 900_000 || !IsGymPurchaseReference(gw.charges[0].ReferenceID) {
		t.Fatalf("charges %+v", gw.charges)
	}
	var purchaseID, status, method string
	e.scalar(&purchaseID, `SELECT renewal_purchase_id::text FROM gym.member_passes WHERE id = $1`, pass.ID)
	e.scalar(&status, `SELECT status FROM gym.credit_purchases WHERE id = $1`, purchaseID)
	e.scalar(&method, `SELECT payment_method FROM gym.credit_purchases WHERE id = $1`, purchaseID)
	if status != "paid" || method != "saved_method" {
		t.Fatalf("renewal purchase %s %s", status, method)
	}
	next := e.passOf(purchaseID)
	if !next.StartsAt.Equal(pass.EndsAt) || !next.AutoRenew || next.RenewWith != "saved_method" {
		t.Fatalf("renewed pass %+v", next)
	}
	if n := e.notices(c, "gym_pass_renewal"); n != 1 {
		t.Fatalf("renewal notices %d", n)
	}

	// Unlinking cancels the token and moves renewals to invoice.
	e.data(asMember, "DELETE", "/api/member-portal/gym/payment-methods/"+id, nil)
	if len(gw.canceled) != 1 || gw.canceled[0] != fakeToken {
		t.Fatalf("canceled %v", gw.canceled)
	}
	if _, with, _, _, _ := e.passState(next.ID); with != "invoice" {
		t.Fatalf("renew_with after unlink %s", with)
	}
	if got := e.data(asMember, "GET", "/api/member-portal/gym/payment-methods", nil); len(got["methods"].([]any)) != 0 {
		t.Fatalf("after unlink %v", got)
	}
}

func TestSavedMethodRetryThenStop(t *testing.T) {
	e, gw := savedSetup(t)
	c := e.member.CustomerID
	pkg := e.passPkg("Go Pass Retry", 500_000, 28)
	pass := e.passOf(e.buy(pkg).ID)
	e.link()
	e.data(asMember, "PUT", "/api/member-portal/gym/passes/"+pass.ID+"/auto-renew", map[string]any{"auto_renew": true, "renew_with": "saved_method"})
	gw.outcome = "FAILED"
	live := func() int {
		return e.count(`SELECT count(*)::int FROM gym.credit_purchases WHERE customer_id = $1 AND status IN ('pending', 'paid') AND payment_method = 'saved_method'`, c)
	}

	// Attempt 1 is declined: a retry is planned 24 hours later.
	first := pass.EndsAt.Add(-2 * day)
	if err := e.sweep(first); err != nil {
		t.Fatal(err)
	}
	on, _, attempts, retryAt, _ := e.passState(pass.ID)
	if !on || attempts != 1 || retryAt == nil || !retryAt.Equal(first.Add(24*time.Hour)) {
		t.Fatalf("after attempt 1: %v %d %v", on, attempts, retryAt)
	}
	if n := e.notices(c, "gym_pass_renewal"); n != 1 {
		t.Fatalf("notices after attempt 1 %d", n)
	}
	// Nothing happens before the retry is due.
	if err := e.sweep(first.Add(time.Hour)); err != nil || len(gw.charges) != 1 {
		t.Fatalf("early retry: %d charges, %v", len(gw.charges), err)
	}

	// Attempt 2 stays pending, then the failure webhook closes it.
	gw.outcome = "PENDING"
	if err := e.sweep(*retryAt); err != nil {
		t.Fatal(err)
	}
	if _, _, attempts, retryAt, _ = e.passState(pass.ID); attempts != 2 || retryAt != nil || live() != 1 {
		t.Fatalf("after attempt 2: %d %v live %d", attempts, retryAt, live())
	}
	// One live renewal purchase: a sweep while it is pending charges nothing.
	if err := e.sweep(first.Add(25 * time.Hour)); err != nil || len(gw.charges) != 2 {
		t.Fatalf("sweep while pending: %d charges, %v", len(gw.charges), err)
	}
	var ref string
	e.scalar(&ref, `SELECT cp.external_id FROM gym.member_passes mp JOIN gym.credit_purchases cp ON cp.id = mp.renewal_purchase_id WHERE mp.id = $1`, pass.ID)
	if res, err := e.svc.HandleGatewayEvent(e.ctx, GatewayEvent{Event: "payment.failure", ReferenceID: ref, Status: "FAILED"}); err != nil || res.Status != "payment_failed" {
		t.Fatalf("failure webhook %+v %v", res, err)
	}
	second := first.Add(26 * time.Hour)
	if err := e.sweep(second); err != nil {
		t.Fatal(err)
	}
	if _, _, attempts, retryAt, _ = e.passState(pass.ID); attempts != 2 || retryAt == nil || !retryAt.Equal(second.Add(24*time.Hour)) {
		t.Fatalf("after failure webhook: %d %v", attempts, retryAt)
	}

	// Attempt 3 (the pass has ended, inside the grace period) fails: auto-renew stops.
	gw.outcome = "FAILED"
	if err := e.sweep(*retryAt); err != nil {
		t.Fatal(err)
	}
	on, _, attempts, retryAt, reason := e.passState(pass.ID)
	if on || attempts != 3 || retryAt != nil || reason == nil || *reason != "renewal_failed" {
		t.Fatalf("final: %v %d %v %v", on, attempts, retryAt, reason)
	}
	if len(gw.charges) != 3 || live() != 0 {
		t.Fatalf("charges %d live %d", len(gw.charges), live())
	}
	if n := e.notices(c, "gym_pass_renewal"); n != 4 {
		t.Fatalf("notices %d (fail 1, pending 2, fail 2, final)", n)
	}
	if n := e.count(`SELECT count(*)::int FROM crm.member_notifications WHERE customer_id = $1 AND title = 'Perpanjangan otomatis dimatikan'`, c); n != 1 {
		t.Fatalf("final notices %d", n)
	}
	// Later sweeps leave it alone.
	if err := e.sweep(pass.EndsAt.Add(2 * day)); err != nil || len(gw.charges) != 3 {
		t.Fatalf("after stop: %d charges, %v", len(gw.charges), err)
	}
	view := e.data(asMember, "PUT", "/api/member-portal/gym/passes/"+pass.ID+"/auto-renew", map[string]any{"auto_renew": false})
	if view["auto_renew_off_reason"] != "renewal_failed" {
		t.Fatalf("pass view %v", view)
	}
}

func TestSavedMethodTokenInvalidFallsBackToInvoice(t *testing.T) {
	e, gw := savedSetup(t)
	pkg := e.passPkg("Go Pass Token", 400_000, 28)
	pass := e.passOf(e.buy(pkg).ID)
	id := e.link()
	e.data(asMember, "PUT", "/api/member-portal/gym/passes/"+pass.ID+"/auto-renew", map[string]any{"auto_renew": true, "renew_with": "saved_method"})
	gw.tokenInvalid = true

	first := pass.EndsAt.Add(-2 * day)
	if err := e.sweep(first); err != nil {
		t.Fatal(err)
	}
	var status string
	e.scalar(&status, `SELECT status FROM gym.member_payment_methods WHERE id = $1`, id)
	_, with, attempts, retryAt, _ := e.passState(pass.ID)
	if status != "expired" || with != "invoice" || attempts != 1 || retryAt == nil {
		t.Fatalf("token gone: %s %s %d %v", status, with, attempts, retryAt)
	}
	// The retry opens an invoice instead of charging the dead token.
	if err := e.sweep(*retryAt); err != nil {
		t.Fatal(err)
	}
	var method, url string
	e.scalar(&method, `SELECT cp.payment_method FROM gym.member_passes mp JOIN gym.credit_purchases cp ON cp.id = mp.renewal_purchase_id WHERE mp.id = $1`, pass.ID)
	e.scalar(&url, `SELECT cp.payment_meta->>'invoice_url' FROM gym.member_passes mp JOIN gym.credit_purchases cp ON cp.id = mp.renewal_purchase_id WHERE mp.id = $1`, pass.ID)
	if len(gw.charges) != 1 || method != "invoice" || !strings.HasPrefix(url, "https://app.example.test/member/wallet/pay/") {
		t.Fatalf("retry %s %q, %d charges", method, url, len(gw.charges))
	}
}

func TestRenewalByInvoiceNeedsAppURL(t *testing.T) {
	t.Setenv("XENDIT_SECRET_KEY", "")
	t.Setenv("XENDIT_MOCK", "1")
	t.Setenv("NEXT_PUBLIC_APP_URL", "")
	t.Setenv("NEXT_PUBLIC_BASE_URL", "")
	e := setup(t)
	var alerts []string
	e.svc.WithAlerts(func(reason string) { alerts = append(alerts, reason) })
	pass := e.passOf(e.buy(e.passPkg("Go Pass URL", 300_000, 28)).ID)
	e.data(asMember, "PUT", "/api/member-portal/gym/passes/"+pass.ID+"/auto-renew", map[string]any{"auto_renew": true, "renew_with": "invoice"})

	if err := e.svc.CheckRenewalSetup(e.ctx); err != nil || len(alerts) != 1 || alerts[0] != AlertRenewalNoAppURL {
		t.Fatalf("startup check: %v %v", alerts, err)
	}
	err := e.sweep(pass.EndsAt.Add(-2 * day))
	if !errors.Is(err, errNoAppOrigin) || len(alerts) != 2 {
		t.Fatalf("sweep without app URL: %v, alerts %v", err, alerts)
	}
	// Nothing was bought and the renewal stays open for the next run.
	if n := e.count(`SELECT count(*)::int FROM gym.member_passes WHERE id = $1 AND renewal_handled_at IS NULL AND renewal_purchase_id IS NULL`, pass.ID); n != 1 {
		t.Fatal("renewal claimed without an app URL")
	}
	t.Setenv("NEXT_PUBLIC_BASE_URL", "https://base.example.test/")
	if err := e.sweep(pass.EndsAt.Add(-2 * day)); err != nil {
		t.Fatal(err)
	}
	var url string
	e.scalar(&url, `SELECT cp.payment_meta->>'invoice_url' FROM gym.member_passes mp JOIN gym.credit_purchases cp ON cp.id = mp.renewal_purchase_id WHERE mp.id = $1`, pass.ID)
	if !strings.HasPrefix(url, "https://base.example.test/member/wallet/pay/") {
		t.Fatalf("invoice redirect %q", url)
	}
}

func TestSavedChargeExpiresOnlyAfterCancel(t *testing.T) {
	e, gw := savedSetup(t)
	pass := e.passOf(e.buy(e.passPkg("Go Pass Pending", 450_000, 28)).ID)
	e.link()
	e.data(asMember, "PUT", "/api/member-portal/gym/passes/"+pass.ID+"/auto-renew", map[string]any{"auto_renew": true, "renew_with": "saved_method"})
	gw.outcome = "PENDING"
	first := pass.EndsAt.Add(-2 * day)
	if err := e.sweep(first); err != nil {
		t.Fatal(err)
	}
	var purchaseID string
	e.scalar(&purchaseID, `SELECT renewal_purchase_id::text FROM gym.member_passes WHERE id = $1`, pass.ID)
	e.exec(`UPDATE gym.credit_purchases SET created_at = now() - interval '1 hour' WHERE id = $1`, purchaseID)
	status := func() string {
		var s string
		e.scalar(&s, `SELECT status FROM gym.credit_purchases WHERE id = $1`, purchaseID)
		return s
	}

	// Inside its 24 hours the reconcile job leaves the charge alone.
	e.at(first, 2*time.Hour)
	if err := e.svc.ReconcilePendingPurchases(e.ctx, time.Now()); err != nil || status() != "pending" || len(gw.canceled) != 0 {
		t.Fatalf("early reconcile: %s, canceled %v, %v", status(), gw.canceled, err)
	}
	// Past it, Xendit cancels the charge first, then the purchase expires
	// and the next sweep plans a retry.
	e.at(first, savedChargeTTL+time.Minute)
	if err := e.svc.ReconcilePendingPurchases(e.ctx, time.Now()); err != nil || status() != "expired" {
		t.Fatalf("late reconcile: %s %v", status(), err)
	}
	if len(gw.canceled) != 1 || gw.canceled[0] != "pr-test-1" {
		t.Fatalf("canceled %v", gw.canceled)
	}
	if err := e.sweep(first.Add(savedChargeTTL + time.Hour)); err != nil {
		t.Fatal(err)
	}
	if _, _, attempts, retryAt, _ := e.passState(pass.ID); attempts != 1 || retryAt == nil {
		t.Fatalf("after expiry: %d %v", attempts, retryAt)
	}
}
