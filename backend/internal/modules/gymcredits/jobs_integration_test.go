package gymcredits

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/paygate"
)

// paidQR is an active Xendit gateway whose every QR has a successful payment.
type paidQR struct{}

var paidQRConfig = &paygate.Config{Provider: paygate.Xendit, Environment: "sandbox", SecretKey: "test"}

func (paidQR) Resolve(context.Context, database.Querier) (paygate.Adapter, *paygate.Config, error) {
	return paidQR{}, paidQRConfig, nil
}

func (paidQR) Lookup(context.Context, database.Querier, paygate.Provider) (paygate.Adapter, *paygate.Config, error) {
	return paidQR{}, paidQRConfig, nil
}

func (paidQR) Provider() paygate.Provider                                 { return paygate.Xendit }
func (paidQR) HostedProblem(*paygate.Config) string                       { return "" }
func (paidQR) Cancel(context.Context, *paygate.Config, paygate.Ref) error { return nil }

func (paidQR) CreateQR(context.Context, *paygate.Config, paygate.QRRequest) (*paygate.QR, error) {
	return nil, nil
}

// CreateHosted answers like XENDIT_MOCK: the page is the redirect URL.
func (paidQR) CreateHosted(_ context.Context, _ *paygate.Config, req paygate.HostedRequest) (*paygate.Hosted, error) {
	return &paygate.Hosted{ID: "mock-" + req.ReferenceID, URL: req.RedirectURL, ExpiresAt: time.Now().Add(2 * time.Hour), Mock: true}, nil
}

func (paidQR) Status(_ context.Context, _ *paygate.Config, ref paygate.Ref) (*paygate.Status, error) {
	if ref.QRID == "" && ref.HostedID == "" {
		return &paygate.Status{State: paygate.StatePending}, nil
	}
	return &paygate.Status{State: paygate.StatePaid, PaymentID: "pay_" + ref.QRID + ref.HostedID, Raw: "SUCCEEDED"}, nil
}

func (e *env) pendingPurchase(pkg, channel string, meta map[string]any, age time.Duration) string {
	e.t.Helper()
	raw, _ := json.Marshal(meta)
	var id string
	e.scalar(&id, `INSERT INTO gym.credit_purchases
		(customer_id, package_id, credits, price_idr, total_idr, channel, payment_method, payment_meta, created_at)
		VALUES ($1, $2, 5, 100000, 100000, $3, 'qris', $4::jsonb, now() - make_interval(secs => $5))
		RETURNING id`, e.member.CustomerID, pkg, channel, string(raw), age.Seconds())
	return id
}

func TestReconcilePendingPurchases(t *testing.T) {
	e := setup(t)
	e.svc.ports.Gateway = paidQR{}
	pkg := e.pkg("Go Reconcile", 5, 100000, 30, nil)
	past, future := isoString(time.Now().Add(-time.Minute)), isoString(time.Now().Add(20*time.Minute))

	stale := e.pendingPurchase(pkg, "member_portal", map[string]any{"qr_id": nil, "expires_at": past}, 40*time.Minute)
	fresh := e.pendingPurchase(pkg, "member_portal", map[string]any{"qr_id": nil, "expires_at": past}, 0)
	desk := e.pendingPurchase(pkg, "front_desk", map[string]any{}, time.Hour)
	paid := e.pendingPurchase(pkg, "member_portal", map[string]any{"qr_id": "qr_1", "expires_at": future}, 5*time.Minute)

	if err := e.svc.ReconcilePendingPurchases(e.ctx, time.Now()); err != nil {
		t.Fatal(err)
	}
	for id, want := range map[string]string{stale: "expired", fresh: "pending", desk: "pending", paid: "paid"} {
		var got string
		e.scalar(&got, `SELECT status FROM gym.credit_purchases WHERE id = $1`, id)
		if got != want {
			t.Errorf("purchase %s: status %s, want %s", id, got, want)
		}
	}
	if b := e.balance(); b != 5 {
		t.Fatalf("balance after the reconciled payment = %d, want 5", b)
	}
	// A second run changes nothing.
	if err := e.svc.ReconcilePendingPurchases(e.ctx, time.Now()); err != nil {
		t.Fatal(err)
	}
	if b := e.balance(); b != 5 {
		t.Fatalf("rerun issued credits again: %d", b)
	}
}

func (e *env) notices(customerID, kind string) int {
	e.t.Helper()
	var n int
	e.scalar(&n, `SELECT count(*)::int FROM crm.member_notifications WHERE customer_id = $1 AND type = $2`, customerID, kind)
	return n
}

func TestCreditReminders(t *testing.T) {
	e := setup(t)
	c := e.member.CustomerID
	// 3 credits that lapse in 5 days: inside the 7-day reminder and at the low-balance threshold of 3.
	e.buy(e.pkg("Go Short 3", 3, 100000, 5, nil))

	var passPkg string
	e.scalar(&passPkg, `INSERT INTO gym.credit_packages (name, kind, credits, price_idr, validity_days)
		VALUES ('Go Pass', 'pass', 0, 500000, 30) RETURNING id`)
	customer := func() string {
		var id string
		e.scalar(&id, `INSERT INTO pos.pos_customers (phone, name) VALUES ('+6297' || substr(md5(random()::text), 1, 9), 'Go Pass') RETURNING id::text`)
		return id
	}
	pass := func(customerID string, from, to time.Duration) {
		e.exec(`INSERT INTO gym.member_passes (customer_id, package_id, starts_at, ends_at) VALUES ($1, $2, now() + make_interval(secs => $3), now() + make_interval(secs => $4))`,
			customerID, passPkg, from.Seconds(), to.Seconds())
	}
	ending, renewed := customer(), customer()
	pass(ending, -27*24*time.Hour, 3*24*time.Hour)
	pass(renewed, -27*24*time.Hour, 3*24*time.Hour)
	pass(renewed, 3*24*time.Hour, 33*24*time.Hour)

	for run := range 2 {
		if err := e.svc.SendCreditReminders(e.ctx, time.Now()); err != nil {
			t.Fatal(err)
		}
		if n := e.notices(c, "gym_credit_expiring"); n != 1 {
			t.Fatalf("run %d: credit expiry reminders = %d, want 1", run, n)
		}
		if n := e.notices(c, "gym_low_balance"); n != 1 {
			t.Fatalf("run %d: low balance nudges = %d, want 1", run, n)
		}
		if n := e.notices(ending, "gym_pass_expiring"); n != 1 {
			t.Fatalf("run %d: pass reminders = %d, want 1", run, n)
		}
		if n := e.notices(renewed, "gym_pass_expiring"); n != 0 {
			t.Fatalf("run %d: renewed member reminded %d times", run, n)
		}
	}
	var body string
	e.scalar(&body, `SELECT body FROM crm.member_notifications WHERE customer_id = $1 AND type = 'gym_credit_expiring'`, c)
	if body[:9] != "3 kredit " {
		t.Fatalf("body %q", body)
	}
	var events int
	e.scalar(&events, `SELECT count(*)::int FROM platform.outbox_events WHERE topic = 'gym.member.notified' AND key = $1`, c)
	if events != 2 {
		t.Fatalf("outbox events = %d, want 2", events)
	}

	// A top-up starts a new low-balance period, but 3 + 3 credits is above the threshold.
	e.buy(e.pkg("Go Short 3b", 3, 100000, 60, nil))
	if err := e.svc.SendCreditReminders(e.ctx, time.Now()); err != nil {
		t.Fatal(err)
	}
	if n := e.notices(c, "gym_low_balance"); n != 1 {
		t.Fatalf("nudged above the threshold: %d", n)
	}
}
