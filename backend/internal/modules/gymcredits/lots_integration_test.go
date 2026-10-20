package gymcredits

import (
	"encoding/json"
	"math"
	"testing"
	"time"

	contracts "nuhabit/backend/internal/contracts/gymcredits"
	"nuhabit/backend/internal/platform/testutil"
)

// Lot-aware ledger, refunds, sweeps and the journals they publish.

// journals returns the gym journal events published for a document.
func (e *env) journals(documentID string) map[string]contracts.Journal {
	e.t.Helper()
	rows, err := e.tx.Query(e.ctx, `SELECT payload FROM platform.outbox_events WHERE topic = $1 AND payload->>'document_id' = $2`,
		contracts.TopicJournal, documentID)
	if err != nil {
		e.t.Fatal(err)
	}
	defer rows.Close()
	out := map[string]contracts.Journal{}
	for rows.Next() {
		var raw []byte
		var j contracts.Journal
		if err := rows.Scan(&raw); err != nil {
			e.t.Fatal(err)
		}
		if err := json.Unmarshal(raw, &j); err != nil {
			e.t.Fatal(err)
		}
		out[j.EventCode] = j
	}
	return out
}

// lotOf is the lot a purchase issued.
func (e *env) lotOf(purchaseID string) string {
	e.t.Helper()
	var id string
	e.scalar(&id, `SELECT id::text FROM gym.credit_lots WHERE purchase_id = $1`, purchaseID)
	return id
}

// remaining is the credits left in a lot, per the wallet.
func (e *env) remaining(lotID string) int {
	e.t.Helper()
	w, err := e.svc.Wallet(e.ctx, e.tx, e.member.CustomerID, 1)
	if err != nil {
		e.t.Fatal(err)
	}
	for _, l := range w.Lots {
		if l.ID == lotID {
			return l.Remaining
		}
	}
	e.t.Fatalf("lot %s not in wallet", lotID)
	return 0
}

func (e *env) usable(classTypeID string) int {
	e.t.Helper()
	n, err := e.svc.UsableBalance(e.ctx, e.tx, e.member.CustomerID, classTypeID)
	if err != nil {
		e.t.Fatal(err)
	}
	return n
}

func TestClassRestrictedDeductions(t *testing.T) {
	e := setup(t)
	c := e.member.CustomerID
	var sim, lift string
	e.scalar(&sim, `INSERT INTO gym.class_types (name, default_duration_min, default_credit_cost, default_capacity)
		VALUES ('Go Sim', 60, 1, 10) RETURNING id::text`)
	e.scalar(&lift, `INSERT INTO gym.class_types (name, default_duration_min, default_credit_cost, default_capacity)
		VALUES ('Go Lift', 60, 1, 10) RETURNING id::text`)
	race := e.pkg("Go Race", 3, 300_000, 60, nil)
	open := e.pkg("Go Open", 5, 500_000, 30, nil)
	strength := e.pkg("Go Strength", 2, 300_000, 10, nil)
	e.exec(`UPDATE gym.credit_packages SET applicable_class_type_ids = ARRAY[$2::uuid] WHERE id = $1`, race, sim)
	e.exec(`UPDATE gym.credit_packages SET applicable_class_type_ids = ARRAY[$2::uuid] WHERE id = $1`, strength, lift)
	raceLot, openLot, strengthLot := e.lotOf(e.buy(race).ID), e.lotOf(e.buy(open).ID), e.lotOf(e.buy(strength).ID)

	if e.usable(sim) != 8 || e.usable(lift) != 7 || e.usable("00000000-0000-4000-8000-000000000009") != 5 || e.balance() != 10 {
		t.Fatalf("usable sim %d lift %d other %d", e.usable(sim), e.usable(lift), e.usable(""))
	}

	// Restricted credits that cover the class go first, then open credits;
	// the deduction splits, each entry names its lot.
	move := CreditMove{CustomerID: c, Amount: 4, ClassTypeID: sim, SourceType: "class_booking", SourceID: race, IdempotencyKey: "go-sim-" + c}
	if ok, after, err := e.svc.Deduct(e.ctx, e.tx, move); err != nil || !ok || after != 6 {
		t.Fatalf("deduct: %v %d %v", ok, after, err)
	}
	if ok, _, err := e.svc.Deduct(e.ctx, e.tx, move); err != nil || !ok {
		t.Fatalf("repeat deduct: %v %v", ok, err)
	}
	var split int
	e.scalar(&split, `SELECT count(*)::int FROM gym.credit_ledger WHERE customer_id = $1 AND type = 'class_deduction' AND lot_id IS NOT NULL`, c)
	if split != 2 || e.remaining(raceLot) != 0 || e.remaining(openLot) != 4 || e.remaining(strengthLot) != 2 {
		t.Fatalf("split %d race %d open %d strength %d", split, e.remaining(raceLot), e.remaining(openLot), e.remaining(strengthLot))
	}

	// A booking supplies the class type when the move names none.
	var session, booking string
	e.scalar(&session, `INSERT INTO gym.class_sessions (class_type_id, starts_at, ends_at, capacity, credit_cost, booking_opens_at, booking_closes_at)
		VALUES ($1, now(), now() + interval '1 hour', 10, 1, now() - interval '1 day', now()) RETURNING id::text`, lift)
	e.scalar(&booking, `INSERT INTO gym.bookings (session_id, customer_id, status) VALUES ($1, $2, 'confirmed') RETURNING id::text`, session, c)
	if ok, _, err := e.svc.Deduct(e.ctx, e.tx, CreditMove{CustomerID: c, Amount: 2, SourceType: "class_booking", SourceID: booking,
		IdempotencyKey: "go-lift-" + booking}); err != nil || !ok {
		t.Fatalf("booking deduct: %v %v", ok, err)
	}
	if e.remaining(strengthLot) != 0 || e.remaining(openLot) != 4 {
		t.Fatalf("strength %d open %d", e.remaining(strengthLot), e.remaining(openLot))
	}

	// Credits restricted to other classes never pay.
	if ok, _, err := e.svc.Deduct(e.ctx, e.tx, CreditMove{CustomerID: c, Amount: 5, ClassTypeID: lift, SourceType: "class_booking",
		SourceID: lift, IdempotencyKey: "go-short-" + c}); err != nil || ok {
		t.Fatalf("short deduct allowed: %v %v", ok, err)
	}

	// A refund goes back to the lots the booking drew from.
	refund := move
	refund.IdempotencyKey = "go-sim-refund-" + c
	for range 2 {
		if err := e.svc.RefundClass(e.ctx, e.tx, refund); err != nil {
			t.Fatal(err)
		}
	}
	if e.remaining(raceLot) != 3 || e.remaining(openLot) != 5 || e.balance() != 8 {
		t.Fatalf("after refund race %d open %d balance %d", e.remaining(raceLot), e.remaining(openLot), e.balance())
	}

	// Each lot move posts at its lot's unit price.
	var ids []string
	e.scalar(&ids, `SELECT array_agg(id::text) FROM gym.credit_ledger WHERE customer_id = $1 AND type IN ('class_deduction', 'refund')`, c)
	usage, reversal := 0.0, 0.0
	for _, id := range ids {
		j := e.journals(id)
		usage += j["GYM_CREDIT_USAGE"].Amount
		reversal += j["GYM_CREDIT_USAGE_REVERSAL"].Amount
	}
	// sim: 3 race (100k each) + 1 open (100k); lift: 2 strength (150k each).
	if usage != 700_000 || reversal != 400_000 {
		t.Fatalf("usage %v reversal %v", usage, reversal)
	}
}

func TestPartialPurchaseRefund(t *testing.T) {
	e := setup(t)
	c := e.member.CustomerID
	pkg := e.pkg("Go Ten", 10, 1_500_000, 90, nil)
	e.exec(`UPDATE pos.pos_customers SET ark_coin_balance = 2000000 WHERE id = $1`, c)
	sale, err := e.svc.SellPackage(e.ctx, FrontDeskSale{CustomerID: c, PackageID: pkg, PaymentMethod: "ark_coin", CashierID: e.staff.UserID})
	if err != nil {
		t.Fatal(err)
	}
	if j := e.journals(sale.ID)["GYM_SALE_ARK_COIN"]; j.Amount != 1_500_000 {
		t.Fatalf("sale journal %+v", j)
	}
	if _, _, err := e.svc.Deduct(e.ctx, e.tx, CreditMove{CustomerID: c, Amount: 1, SourceType: "class_booking", SourceID: pkg, IdempotencyKey: "go-use-" + c}); err != nil {
		t.Fatal(err)
	}

	refunded, err := e.svc.RefundPurchaseTx(e.ctx, sale.ID, "pindah kota", e.staff.UserID, false)
	if err != nil {
		t.Fatal(err)
	}
	meta := refunded.meta()
	if refunded.Status != "refunded" || meta["refund_idr"] != 1_350_000.0 || meta["refund_credits"] != 9.0 {
		t.Fatalf("refund %+v %v", refunded, meta)
	}
	if ark := e.arkBalance(); ark != 500_000+1_350_000 {
		t.Fatalf("ark %v", ark)
	}
	if b := e.balance(); b != 0 {
		t.Fatalf("balance %d", b)
	}
	if j := e.journals(sale.ID)["GYM_REFUND_ARK_COIN"]; j.Amount != 1_350_000 {
		t.Fatalf("refund journal %+v", j)
	}

	// Nothing unused, nothing to refund.
	used := e.buy(e.pkg("Go One", 1, 100_000, 30, nil))
	if _, _, err := e.svc.Deduct(e.ctx, e.tx, CreditMove{CustomerID: c, Amount: 1, SourceType: "class_booking", SourceID: used.ID, IdempotencyKey: "go-use2-" + c}); err != nil {
		t.Fatal(err)
	}
	_, err = e.svc.RefundPurchaseTx(e.ctx, used.ID, "minta refund", e.staff.UserID, false)
	wantErr(t, err, 409, "sudah terpakai")
}

func TestBranchRulesAndPrices(t *testing.T) {
	e := setup(t)
	org := testutil.CreateOrg(t, e.tx)
	c := e.member.CustomerID

	// A positive adjustment at a branch expires by that branch's rules.
	e.exec(`INSERT INTO gym.business_rules (branch_id, rules) VALUES ($1, '{"creditExpiryDays": 10}')`, org.BranchID)
	if _, err := e.svc.Adjust(e.ctx, e.tx, c, 2, "kompensasi", e.staff.UserID, &org.BranchID); err != nil {
		t.Fatal(err)
	}
	var days float64
	e.scalar(&days, `SELECT extract(epoch FROM expires_at - created_at) / 86400 FROM gym.credit_lots WHERE customer_id = $1`, c)
	if math.Round(days) != 10 {
		t.Fatalf("adjustment lot expires after %v days", days)
	}

	// ARK Coin purchases from the portal take the branch price.
	pkg := e.pkg("Go Branch", 4, 400_000, 30, nil)
	e.exec(`INSERT INTO gym.package_branch_prices (package_id, branch_id, price_idr) VALUES ($1, $2, 350000)`, pkg, org.BranchID)
	e.exec(`UPDATE pos.pos_customers SET ark_coin_balance = 1000000 WHERE id = $1`, c)
	view, err := e.svc.BuyWithArk(e.ctx, MemberPurchase{CustomerID: c, PackageID: pkg, BranchID: &org.BranchID})
	if err != nil {
		t.Fatal(err)
	}
	if e.arkBalance() != 650_000 {
		t.Fatalf("ark %v view %+v", e.arkBalance(), view)
	}
	if j := e.journals(view.ID)["GYM_SALE_ARK_COIN"]; j.CompanyID == nil || *j.CompanyID != org.CompanyID {
		t.Fatalf("sale journal company %+v", j)
	}
}

func TestSweeps(t *testing.T) {
	e := setup(t)
	org := testutil.CreateOrg(t, e.tx)
	c := e.member.CustomerID
	now := e.svc.clock()

	// Expiry: lapsed lots of every member, once, with breakage.
	sale := e.buy(e.pkg("Go Lapse", 4, 400_000, 30, nil))
	lot := e.lotOf(sale.ID)
	e.exec(`UPDATE gym.credit_lots SET expires_at = now() - interval '1 hour' WHERE id = $1`, lot)
	if n, err := e.svc.SweepExpiry(e.ctx, now); err != nil || n < 1 {
		t.Fatalf("sweep expiry %d %v", n, err)
	}
	var expiration string
	e.scalar(&expiration, `SELECT id::text FROM gym.credit_ledger WHERE lot_id = $1 AND type = 'expiration'`, lot)
	if j := e.journals(expiration)["GYM_CREDIT_BREAKAGE"]; j.Amount != 400_000 {
		t.Fatalf("breakage %+v", j)
	}
	if _, err := e.svc.SweepExpiry(e.ctx, now); err != nil {
		t.Fatal(err)
	}
	var expirations int
	e.scalar(&expirations, `SELECT count(*)::int FROM gym.credit_ledger WHERE customer_id = $1 AND type = 'expiration'`, c)
	if expirations != 1 {
		t.Fatalf("expirations %d", expirations)
	}

	// Pass revenue: a day's share per day started, nothing twice, the rest
	// taken back on refund.
	pass := e.data(asStaff, "POST", "/api/gym/packages", map[string]any{
		"name": "Go Pass Sweep", "kind": "pass", "price_idr": 2_800_000, "validity_days": 28,
	})["id"].(string)
	passSale := e.data(asStaff, "POST", "/api/gym/credits/"+c+"/sell", map[string]any{
		"package_id": pass, "payment_method": "qris", "branch_id": org.BranchID,
	})
	purchaseID := passSale["id"].(string)
	if j := e.journals(purchaseID)["GYM_SALE_QRIS"]; j.Amount != 2_800_000 {
		t.Fatalf("pass sale journal %+v", j)
	}
	released := func() float64 {
		v, err := e.svc.repo.PassRevenueReleased(e.ctx, e.tx, purchaseID)
		if err != nil {
			t.Fatal(err)
		}
		return v
	}
	if _, err := e.svc.SweepPassRevenue(e.ctx, now); err != nil {
		t.Fatal(err)
	}
	if _, err := e.svc.SweepPassRevenue(e.ctx, now); err != nil {
		t.Fatal(err)
	}
	if r := released(); r != 100_000 {
		t.Fatalf("day one released %v", r)
	}
	if _, err := e.svc.SweepPassRevenue(e.ctx, now.Add(3*24*time.Hour)); err != nil {
		t.Fatal(err)
	}
	if r := released(); r != 400_000 {
		t.Fatalf("day four released %v", r)
	}
	var batch string
	e.scalar(&batch, `SELECT batch_id::text FROM gym.pass_revenue_releases r JOIN gym.member_passes mp ON mp.id = r.pass_id
		WHERE mp.purchase_id = $1 ORDER BY release_date DESC LIMIT 1`, purchaseID)
	if j := e.journals(batch)["GYM_PASS_REVENUE"]; j.Amount < 300_000 || j.CompanyID == nil || *j.CompanyID != org.CompanyID {
		t.Fatalf("pass revenue journal %+v", j)
	}

	e.data(asStaff, "POST", "/api/gym/credits/purchases/"+purchaseID+"/refund", map[string]any{"reason": "batal ikut", "mode": "full"})
	j := e.journals(purchaseID)
	if j["GYM_REFUND_QRIS"].Amount != 2_800_000 || j["GYM_PASS_REVENUE_REVERSAL"].Amount != 400_000 {
		t.Fatalf("pass refund journals %+v", j)
	}
}
