package gymcredits

import (
	"net/http"
	"regexp"
	"strconv"
	"testing"

	"nuhabit/backend/internal/platform/testutil"
)

// A cash sale needs the seller's open shift; card, transfer and QRIS join one
// when it is open. The shift must serve the sale's branch.
func TestFrontDeskSaleJoinsTheShift(t *testing.T) {
	e := setup(t)
	org := testutil.CreateOrg(t, e.tx)
	c := e.member.CustomerID
	pkg := e.pkg("Go Till Pack", 5, 250_000, 60, nil)
	desk := testutil.CreateStaff(t, testutil.StaffOptions{Menus: map[string][]string{"gym.credits": {"read", "create"}}})
	sell := func(body map[string]any, status int) map[string]any {
		t.Helper()
		rec, out := testutil.Do(t, e.mux, testutil.AsStaff(testutil.Request("POST", "/api/gym/credits/"+c+"/sell", body), desk))
		if rec.Code != status {
			t.Fatalf("sell %v: status %d, want %d: %v", body, rec.Code, status, out)
		}
		return out
	}

	out := sell(map[string]any{"package_id": pkg, "payment_method": "cash", "branch_id": org.BranchID}, http.StatusConflict)
	if out["error"] != msgShiftRequired || out["details"].(map[string]any)["code"] != CodeShiftRequired {
		t.Fatalf("cash without a shift: %v", out)
	}
	card := sell(map[string]any{"package_id": pkg, "payment_method": "card", "branch_id": org.BranchID}, http.StatusOK)["data"].(map[string]any)
	if card["pos_shift_id"] != nil {
		t.Fatalf("card without a shift joined one: %v", card)
	}

	// A shift of another branch does not serve this one.
	var otherBranch string
	e.scalar(&otherBranch, `INSERT INTO configuration.branches (company_id, code, name)
		VALUES ($1, 'GT' || substr(md5(random()::text), 1, 6), 'Go Till Other') RETURNING id::text`, org.CompanyID)
	e.openShift(desk.UserID, otherBranch)
	sell(map[string]any{"package_id": pkg, "payment_method": "cash", "branch_id": org.BranchID}, http.StatusConflict)

	shiftID := e.openShift(desk.UserID, org.BranchID)
	for _, method := range []string{"cash", "transfer", "qris"} {
		sale := sell(map[string]any{"package_id": pkg, "payment_method": method, "branch_id": org.BranchID}, http.StatusOK)["data"].(map[string]any)
		if sale["pos_shift_id"] != shiftID || sale["shift_number"] == nil {
			t.Fatalf("%s sale not in the shift: %v", method, sale)
		}
	}
	comp := sell(map[string]any{"package_id": pkg, "payment_method": "complimentary", "branch_id": org.BranchID}, http.StatusOK)["data"].(map[string]any)
	if comp["pos_shift_id"] != nil {
		t.Fatalf("complimentary joined the shift: %v", comp)
	}
}

// Every paid purchase gets the next receipt number of its WIB day; the
// receipt carries the member, the cashier and the shift.
func TestReceiptNumbers(t *testing.T) {
	e := setup(t)
	pkg := e.pkg("Go Receipt Pack", 5, 250_000, 60, nil)
	first, second := e.buy(pkg), e.buy(pkg)
	pattern := regexp.MustCompile(`^GYM-(\d{8})-(\d{4})$`)
	a, b := pattern.FindStringSubmatch(deref(first.ReceiptNumber)), pattern.FindStringSubmatch(deref(second.ReceiptNumber))
	if a == nil || b == nil || a[1] != b[1] {
		t.Fatalf("receipt numbers %v %v", first.ReceiptNumber, second.ReceiptNumber)
	}
	n1, _ := strconv.Atoi(a[2])
	n2, _ := strconv.Atoi(b[2])
	if n2 != n1+1 {
		t.Fatalf("receipt numbers not consecutive: %s, %s", a[0], b[0])
	}
	var counter int
	e.scalar(&counter, `SELECT last_no FROM gym.receipt_counters WHERE day = to_date($1, 'YYYYMMDD')`, a[1])
	if counter != n2 {
		t.Fatalf("counter %d, last receipt %d", counter, n2)
	}

	receipt := e.data(asStaff, "GET", "/api/gym/credits/purchases/"+first.ID+"/receipt", nil)
	if receipt["receipt_number"] != a[0] || receipt["member_name"] == nil || receipt["cashier_name"] != e.staff.FullName ||
		receipt["shift_number"] == nil || receipt["total_idr"] != 250000.0 || receipt["payment_method"] != "cash" {
		t.Fatalf("receipt %v", receipt)
	}
	if _, ok := receipt["header_lines"].([]any); !ok {
		t.Fatalf("receipt header %v", receipt["header_lines"])
	}

	// Refunding keeps the number; a pending purchase has none.
	if _, err := e.svc.RefundPurchaseTx(e.ctx, first.ID, "salah jual", e.staff.UserID, false); err != nil {
		t.Fatal(err)
	}
	refunded := e.data(asStaff, "GET", "/api/gym/credits/purchases/"+first.ID+"/receipt", nil)
	if refunded["receipt_number"] != a[0] || refunded["status"] != "refunded" || refunded["refunded_idr"] != 250000.0 {
		t.Fatalf("refunded receipt %v", refunded)
	}
	var pending string
	e.scalar(&pending, `INSERT INTO gym.credit_purchases (customer_id, package_id, credits, price_idr, total_idr, channel, payment_method)
		VALUES ($1, $2, 5, 250000, 250000, 'member_portal', 'qris') RETURNING id::text`, e.member.CustomerID, pkg)
	e.fail(asStaff, "GET", "/api/gym/credits/purchases/"+pending+"/receipt", nil, 404, "Struk pembelian tidak ditemukan")
}
