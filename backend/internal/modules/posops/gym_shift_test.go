package posops_test

import (
	"errors"
	"regexp"
	"testing"

	"nuhabit/backend/internal/modules/gymcredits"
	"nuhabit/backend/internal/platform/testutil"
)

// Gym front desk sales join the seller's own shift: cash needs one, the
// close-out counts gym sales and refunds, and the shift close posts no POS
// journal for them (gym-credits already journals each sale).
func TestGymSalesInTheDeskShift(t *testing.T) {
	// The member is removed after the rollback, so it is created first.
	member := testutil.CreateMember(t)
	h := newHarness(t, map[string][]string{"gym.credits": {"read", "create", "update"}})
	org := testutil.CreateOrg(t, h.tx)
	credits := gymcredits.NewDefaultService(h.deps, h.tx)
	pkg := h.id(`INSERT INTO gym.credit_packages (name, credits, price_idr, validity_days)
		VALUES ('Go Shift Pack', 10, 300000, 60) RETURNING id::text`)
	sell := func(method string) (*gymcredits.Purchase, error) {
		return credits.SellPackage(h.ctx, gymcredits.FrontDeskSale{
			CustomerID: member.CustomerID, PackageID: pkg, PaymentMethod: method, BranchID: &org.BranchID, CashierID: h.staff.UserID,
		})
	}
	var settledBefore int
	h.scalar(&settledBefore, `SELECT count(*)::int FROM platform.outbox_events WHERE topic = 'pos.sale.settled'`)

	h.anon("GET", "/api/pos/shifts/mine", nil, 401)
	r := h.call("GET", "/api/pos/shifts/mine?branch_id="+org.BranchID, nil, 200)
	if r.body["data"] != nil {
		t.Fatalf("no shift yet: %s", r.raw)
	}
	var gymErr *gymcredits.Error
	if _, err := sell("cash"); !errors.As(err, &gymErr) || gymErr.Status != 409 || gymErr.Code != gymcredits.CodeShiftRequired {
		t.Fatalf("cash without a shift: %v", err)
	}
	qris, err := sell("qris")
	if err != nil || qris.PosShiftID != nil {
		t.Fatalf("QRIS without a shift is sold outside any shift: %+v %v", qris, err)
	}

	r = h.call("POST", "/api/pos/shifts/mine?branch_id="+org.BranchID, map[string]any{"opening_cash": 100000}, 200)
	shift := data(r)
	shiftID := shift["id"].(string)
	if shift["cashier_id"] != h.staff.UserID || shift["branch_id"] != org.BranchID {
		t.Fatalf("desk shift %v", shift)
	}
	h.call("POST", "/api/pos/shifts/mine", map[string]any{"opening_cash": 0}, 409)

	cashA, err := sell("cash")
	if err != nil {
		t.Fatal(err)
	}
	cashB, err := sell("cash")
	if err != nil {
		t.Fatal(err)
	}
	card, err := sell("card")
	if err != nil {
		t.Fatal(err)
	}
	for _, p := range []*gymcredits.Purchase{cashA, cashB, card} {
		if p.PosShiftID == nil || *p.PosShiftID != shiftID || p.ShiftNumber == nil {
			t.Fatalf("sale not in the shift: %+v", p)
		}
	}
	if _, err := credits.RefundPurchaseTx(h.ctx, cashB.ID, "salah jual", h.staff.UserID, false); err != nil {
		t.Fatal(err)
	}
	var refundShift string
	h.scalar(&refundShift, `SELECT refund_shift_id::text FROM gym.credit_purchases WHERE id = $1`, cashB.ID)
	if refundShift != shiftID {
		t.Fatalf("refund shift %q", refundShift)
	}

	// Drawer: 100k opening + 2 x 300k cash - 300k cash refund.
	r = h.call("GET", "/api/pos/shifts/mine?branch_id="+org.BranchID, nil, 200)
	jsonEq(t, obj(data(r)["summary"])["gym_sales"],
		`{"cash":600000,"qris":0,"card":300000,"transfer":0,"sales":900000,"count":3,"refunds":300000,"cash_refunds":300000,"refund_count":1}`)
	if obj(data(r)["summary"])["expected_cash"] != 400000.0 {
		t.Fatalf("live summary %s", r.raw)
	}

	r = h.call("PATCH", "/api/pos/shifts/mine/close?branch_id="+org.BranchID, map[string]any{"closing_cash": 400000}, 200)
	closed := data(r)
	if closed["status"] != "closed" || closed["expected_cash"] != "400000.00" || closed["variance"] != "0.00" ||
		closed["total_sales"] != "900000.00" || closed["total_refunds"] != "300000.00" || closed["total_orders"] != 3.0 ||
		closed["total_cash_sales"] != "600000.00" || closed["total_debit_sales"] != "300000.00" {
		t.Fatalf("closed shift %v", closed)
	}

	// One sale journal per purchase, from gym-credits only.
	var saleJournals, settledAfter int
	h.scalar(&saleJournals, `SELECT count(*)::int FROM platform.outbox_events
		WHERE topic = 'gym.credits.journal' AND key LIKE 'GYM_SALE_%' AND split_part(key, ':', 2) = ANY($1)`,
		[]string{cashA.ID, cashB.ID, card.ID})
	h.scalar(&settledAfter, `SELECT count(*)::int FROM platform.outbox_events WHERE topic = 'pos.sale.settled'`)
	if saleJournals != 3 || settledAfter != settledBefore {
		t.Fatalf("journals: %d gym sale, %d new POS sale events", saleJournals, settledAfter-settledBefore)
	}

	receipt := regexp.MustCompile(`^GYM-\d{8}-\d{4}$`)
	if cashA.ReceiptNumber == nil || !receipt.MatchString(*cashA.ReceiptNumber) || *cashA.ReceiptNumber == *cashB.ReceiptNumber {
		t.Fatalf("receipt numbers %v %v", cashA.ReceiptNumber, cashB.ReceiptNumber)
	}
}
