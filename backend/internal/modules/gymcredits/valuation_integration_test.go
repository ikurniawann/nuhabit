package gymcredits

import (
	"testing"

	"nuhabit/backend/internal/platform/testutil"
)

// Journals that close a lot's deferred revenue at the sen.

// sell sells pkg to the member at branch for cash.
func (e *env) sell(pkgID string, branchID *string) *Purchase {
	e.t.Helper()
	p, err := e.svc.SellPackage(e.ctx, FrontDeskSale{CustomerID: e.member.CustomerID, PackageID: pkgID, PaymentMethod: "cash",
		BranchID: branchID, CashierID: e.staff.UserID})
	if err != nil {
		e.t.Fatal(err)
	}
	return p
}

// deductOne takes one credit of customerID and returns the entry id.
func (e *env) deductOne(customerID, key string) string {
	e.t.Helper()
	ok, _, err := e.svc.Deduct(e.ctx, e.tx, CreditMove{CustomerID: customerID, Amount: 1, SourceType: "class_booking", IdempotencyKey: key})
	if err != nil || !ok {
		e.t.Fatalf("deduct: %v %v", ok, err)
	}
	var id string
	e.scalar(&id, `SELECT id::text FROM gym.credit_ledger WHERE idempotency_key = $1`, key)
	return id
}

func TestLotJournalsNetToZero(t *testing.T) {
	e := setup(t)
	org := testutil.CreateOrg(t, e.tx)
	c := e.member.CustomerID
	pkg := e.pkg("Go Sen", 3, 100_000, 60, nil)

	// Admin takes one credit: valued like usage, under its own event.
	sale := e.sell(pkg, &org.BranchID)
	adjust, err := e.svc.Adjust(e.ctx, e.tx, c, -1, "koreksi admin", e.staff.UserID, &org.BranchID)
	if err != nil {
		t.Fatal(err)
	}
	if j := e.journals(adjust.EntryID)["GYM_CREDIT_ADJUSTMENT"]; j.Amount != 33_333.33 || j.CompanyID == nil || *j.CompanyID != org.CompanyID {
		t.Fatalf("adjustment journal %+v", j)
	}
	var lot string
	e.scalar(&lot, `SELECT lot_id::text FROM gym.credit_ledger WHERE id = $1`, adjust.EntryID)
	if lot != e.lotOf(sale.ID) {
		t.Fatal("a negative adjustment must name the lot it came off")
	}
	// The last two credits carry the rest: 33,333.34 and 33,333.33.
	second := e.deductOne(c, "go-sen-2")
	third := e.deductOne(c, "go-sen-3")
	if a, b := e.journals(second)["GYM_CREDIT_USAGE"].Amount, e.journals(third)["GYM_CREDIT_USAGE"].Amount; a != 33_333.34 || b != 33_333.33 {
		t.Fatalf("usage journals %v %v", a, b)
	}

	// A refund pays whole rupiah; the sen left over closes the lot.
	refunded := e.sell(pkg, &org.BranchID)
	e.deductOne(c, "go-sen-refund")
	if _, err := e.svc.RefundPurchase(e.ctx, e.tx, refunded.ID, "pindah kota", e.staff.UserID, false); err != nil {
		t.Fatal(err)
	}
	var closing string
	e.scalar(&closing, `SELECT id::text FROM gym.credit_ledger WHERE lot_id = $1 AND type = 'reversal'`, e.lotOf(refunded.ID))
	refund := e.journals(refunded.ID)["GYM_REFUND_CASH"]
	residual := e.journals(closing)["GYM_CREDIT_USAGE_REVERSAL"]
	if refund.Amount != 66_667 || residual.Amount != 0.33 {
		t.Fatalf("refund %+v residual %+v", refund, residual)
	}
}
