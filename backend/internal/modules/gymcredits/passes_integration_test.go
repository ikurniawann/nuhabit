package gymcredits

import (
	"testing"
	"time"
)

// Pass lifecycle against TEST_DATABASE_URL: stacking, freeze, extend,
// auto-renew and prorated refunds. Helpers come from gymcredits_integration_test.go.

func (e *env) passPkg(name string, price float64, days int) string {
	e.t.Helper()
	var id string
	e.scalar(&id, `INSERT INTO gym.credit_packages (name, kind, credits, price_idr, validity_days)
		VALUES ($1, 'pass', 0, $2, $3) RETURNING id`, name, price, days)
	return id
}

// at moves the service clock to base + d.
func (e *env) at(base time.Time, d time.Duration) time.Time {
	now := base.Add(d)
	e.svc.now = func() time.Time { return now }
	return now
}

func (e *env) passes() []PassView {
	e.t.Helper()
	wallet, err := e.svc.Wallet(e.ctx, e.tx, e.member.CustomerID, 1)
	if err != nil {
		e.t.Fatal(err)
	}
	return wallet.Passes
}

func (e *env) passOf(purchaseID string) PassRow {
	e.t.Helper()
	p, err := e.svc.repo.PassByPurchase(e.ctx, e.tx, purchaseID)
	if err != nil || p == nil {
		e.t.Fatalf("pass of %s: %v %v", purchaseID, p, err)
	}
	return *p
}

func (e *env) count(sql string, args ...any) int {
	e.t.Helper()
	var n int
	e.scalar(&n, sql, args...)
	return n
}

func TestPassStackFreezeExtend(t *testing.T) {
	e := setup(t)
	c := e.member.CustomerID
	pkg := e.passPkg("Go Pass Stack", 1_400_000, 28)
	base := e.svc.clock()

	first := e.passOf(e.buy(pkg).ID)
	second := e.passOf(e.buy(pkg).ID)
	if !second.StartsAt.Equal(first.EndsAt) || !second.EndsAt.Equal(first.EndsAt.Add(28*day)) {
		t.Fatalf("second pass %v..%v, first ends %v", second.StartsAt, second.EndsAt, first.EndsAt)
	}
	list := e.passes()
	if len(list) != 2 || list[0].ID != first.ID || list[0].Upcoming || !list[1].Upcoming || list[1].DaysLeft != 28 {
		t.Fatalf("passes %+v", list)
	}

	// Freezing: only within the rules, then nothing is covered.
	path := "/api/member-portal/gym/passes/" + first.ID
	e.fail(asMember, "POST", path+"/freeze", map[string]any{"days": 3}, 409, "Pembekuan minimal 7 hari")
	e.fail(asMember, "POST", "/api/member-portal/gym/passes/"+second.ID+"/freeze", map[string]any{"days": 7}, 409, "Pass belum mulai berjalan")
	frozen := e.data(asMember, "POST", path+"/freeze", map[string]any{"days": 7})
	if frozen["status"] != "frozen" || frozen["frozen_until"] == nil || frozen["days_left"] != 28.0 {
		t.Fatalf("frozen %v", frozen)
	}
	e.fail(asMember, "POST", path+"/freeze", map[string]any{"days": 7}, 409, "Pass sudah dibekukan")
	for _, at := range []time.Time{base.Add(time.Hour), second.StartsAt.Add(time.Hour)} {
		if p, err := e.svc.ActivePassAt(e.ctx, e.tx, c, at); err != nil || p != nil {
			t.Fatalf("frozen membership covers %v: %v %v", at, p, err)
		}
	}

	// An early unfreeze adds the days frozen and charges the minimum.
	e.at(base, 2*day+time.Hour)
	thawed := e.data(asStaff, "POST", "/api/gym/passes/"+first.ID+"/unfreeze", nil)
	if thawed["status"] != "active" || thawed["frozen_at"] != nil {
		t.Fatalf("thawed %v", thawed)
	}
	if got := e.passOf(*first.PurchaseID); !got.EndsAt.Equal(first.EndsAt.Add(3 * day)) {
		t.Fatalf("ends %v, want %v", got.EndsAt, first.EndsAt.Add(3*day))
	}
	if got := e.passOf(*second.PurchaseID); !got.StartsAt.Equal(second.StartsAt.Add(3 * day)) {
		t.Fatalf("queued pass not moved: %v", got.StartsAt)
	}
	wallet, err := e.svc.Wallet(e.ctx, e.tx, c, 1)
	if err != nil || wallet.Freeze.UsedDays != 7 || wallet.Freeze.RemainingDays != 23 {
		t.Fatalf("allowance %+v %v", wallet.Freeze, err)
	}

	// The allowance caps the next freeze; a due freeze ends on the sweep.
	e.fail(asMember, "POST", path+"/freeze", map[string]any{"days": 24}, 409, "Sisa jatah pembekuan tahun ini 23 hari")
	e.data(asMember, "POST", path+"/freeze", map[string]any{"days": 7})
	if err := e.svc.SweepFrozen(e.ctx, base.Add(10*day)); err != nil {
		t.Fatal(err)
	}
	if got := e.passOf(*first.PurchaseID); got.Status != "active" || !got.EndsAt.Equal(first.EndsAt.Add(10*day)) {
		t.Fatalf("after sweep %s %v", got.Status, got.EndsAt)
	}
	if n := e.count(`SELECT count(*)::int FROM crm.member_notifications WHERE customer_id = $1 AND type = 'gym_pass_unfrozen'`, c); n != 1 {
		t.Fatalf("unfreeze notifications %d", n)
	}
	if err := e.svc.SweepFrozen(e.ctx, base.Add(10*day)); err != nil {
		t.Fatal(err)
	}

	// Staff extensions need a reason and move the queued pass too.
	e.fail(asStaff, "POST", "/api/gym/passes/"+first.ID+"/extend", map[string]any{"days": 5}, 400, "Invalid input: expected string, received undefined")
	e.data(asStaff, "POST", "/api/gym/passes/"+first.ID+"/extend", map[string]any{"days": 5, "reason": "kompensasi kelas batal"})
	if got := e.passOf(*second.PurchaseID); !got.StartsAt.Equal(second.StartsAt.Add(15 * day)) {
		t.Fatalf("queued after extend %v", got.StartsAt)
	}
	if n := e.count(`SELECT count(*)::int FROM gym.member_pass_events WHERE pass_id = $1`, first.ID); n != 5 {
		t.Fatalf("events %d (freeze, unfreeze, freeze, unfreeze, extend)", n)
	}

	// Another member cannot touch the pass.
	_, err = e.svc.FreezePass(e.ctx, first.ID, 7, PassActor{CustomerID: "00000000-0000-0000-0000-000000000000"})
	wantErr(t, err, 404, "Pass tidak ditemukan")
}

func TestPassAutoRenew(t *testing.T) {
	t.Setenv("XENDIT_SECRET_KEY", "")
	t.Setenv("XENDIT_MOCK", "1")
	t.Setenv("NEXT_PUBLIC_APP_URL", "https://app.example.test")
	e := setup(t)
	c := e.member.CustomerID
	pkg := e.passPkg("Go Pass Renew", 1_000_000, 28)
	e.exec(`UPDATE pos.pos_customers SET ark_coin_balance = 1500000 WHERE id = $1`, c)

	current := e.passOf(e.buy(pkg).ID)
	on := e.data(asMember, "PUT", "/api/member-portal/gym/passes/"+current.ID+"/auto-renew", map[string]any{"auto_renew": true, "renew_with": "ark"})
	if on["auto_renew"] != true || on["renew_with"] != "ark" {
		t.Fatalf("auto-renew %v", on)
	}

	// Outside the window nothing happens; inside it ARK Coin pays at once.
	if err := e.svc.SweepRenewals(e.ctx, current.EndsAt.Add(-4*day)); err != nil {
		t.Fatal(err)
	}
	if n := e.count(`SELECT count(*)::int FROM gym.member_passes WHERE customer_id = $1`, c); n != 1 {
		t.Fatalf("renewed too early: %d passes", n)
	}
	window := current.EndsAt.Add(-2 * day)
	for range 2 { // idempotent
		if err := e.svc.SweepRenewals(e.ctx, window); err != nil {
			t.Fatal(err)
		}
	}
	list := e.passes()
	if len(list) != 2 || !list[1].Upcoming || !time.Time(list[1].StartsAt).Equal(current.EndsAt) || !list[1].AutoRenew || list[1].RenewWith != "ark" {
		t.Fatalf("renewed passes %+v", list)
	}
	if b := e.arkBalance(); b != 500000 {
		t.Fatalf("ark balance %v", b)
	}
	if n := e.count(`SELECT count(*)::int FROM crm.member_notifications WHERE customer_id = $1 AND type = 'gym_pass_renewal'`, c); n != 1 {
		t.Fatalf("renewal notifications %d", n)
	}

	// Short of ARK Coin the renewal falls back to an invoice.
	next := e.passOf(*list[1].PurchaseID)
	if err := e.svc.SweepRenewals(e.ctx, next.EndsAt.Add(-time.Hour)); err != nil {
		t.Fatal(err)
	}
	var purchaseID, method, status string
	e.scalar(&purchaseID, `SELECT renewal_purchase_id::text FROM gym.member_passes WHERE id = $1`, next.ID)
	e.scalar(&method, `SELECT payment_method FROM gym.credit_purchases WHERE id = $1`, purchaseID)
	e.scalar(&status, `SELECT status FROM gym.credit_purchases WHERE id = $1`, purchaseID)
	if method != "invoice" || status != "pending" {
		t.Fatalf("fallback purchase %s %s", method, status)
	}
	paid, err := e.svc.RefreshMemberPurchase(e.ctx, c, purchaseID)
	if err != nil || paid.Status != "paid" {
		t.Fatalf("invoice settle %+v %v", paid, err)
	}
	if third := e.passOf(purchaseID); !third.StartsAt.Equal(next.EndsAt) || !third.AutoRenew {
		t.Fatalf("third pass %+v", third)
	}

	// Staff can switch renewal off.
	off := e.data(asStaff, "PUT", "/api/gym/passes/"+next.ID+"/auto-renew", map[string]any{"auto_renew": false})
	if off["auto_renew"] != false || off["renew_with"] != "ark" {
		t.Fatalf("off %v", off)
	}
}

func TestProratedPassRefund(t *testing.T) {
	e := setup(t)
	c := e.member.CustomerID
	pkg := e.passPkg("Go Pass Refund", 1_400_000, 28)
	e.exec(`UPDATE pos.pos_customers SET ark_coin_balance = 1400000 WHERE id = $1`, c)
	base := e.svc.clock()

	sale, err := e.svc.SellPackage(e.ctx, FrontDeskSale{CustomerID: c, PackageID: pkg, PaymentMethod: "ark_coin", CashierID: e.staff.UserID})
	if err != nil {
		t.Fatal(err)
	}
	queued := e.passOf(e.buy(pkg).ID)
	e.at(base, 7*day)

	quote := e.data(asStaff, "GET", "/api/gym/credits/purchases/"+sale.ID+"/refund-quote", nil)
	if quote["total_days"] != 28.0 || quote["unused_days"] != 21.0 || quote["prorated_idr"] != 1050000.0 || quote["full_idr"] != 1400000.0 {
		t.Fatalf("quote %v", quote)
	}
	refunded := e.data(asStaff, "POST", "/api/gym/credits/purchases/"+sale.ID+"/refund", map[string]any{"reason": "pindah kota"})
	if refunded["status"] != "refunded" || refunded["refunded_idr"] != 1050000.0 {
		t.Fatalf("refund %v", refunded)
	}
	if b := e.arkBalance(); b != 1050000 {
		t.Fatalf("ark back %v", b)
	}
	// The queued pass moves up to start now.
	if got := e.passOf(*queued.PurchaseID); !got.StartsAt.Equal(base.Add(7*day)) || !got.EndsAt.Equal(base.Add(35*day)) {
		t.Fatalf("queued moved to %v..%v", got.StartsAt, got.EndsAt)
	}

	// Full refund on request.
	full := e.data(asStaff, "POST", "/api/gym/credits/purchases/"+*queued.PurchaseID+"/refund", map[string]any{"reason": "salah input", "mode": "full"})
	if full["refunded_idr"] != 1400000.0 {
		t.Fatalf("full refund %v", full)
	}
	e.fail(asStaff, "POST", "/api/gym/credits/purchases/"+sale.ID+"/refund", map[string]any{"reason": "lagi", "mode": "half"}, 400,
		`Invalid option: expected one of "prorated"|"full"`)
}
