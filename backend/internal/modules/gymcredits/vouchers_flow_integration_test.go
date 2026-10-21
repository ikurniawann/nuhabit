package gymcredits

import (
	"strings"
	"testing"
)

// Vouchers beyond the member checkout: the front desk sale, the refund that
// gives the code back, and a purchase paid after it expired.
func TestVoucherDeskRefundAndLatePayment(t *testing.T) {
	e := setup(t)
	c := e.member.CustomerID
	vouchers := &fakeVouchers{discount: 25_000, state: map[string]string{}}
	e.svc.WithVouchers(vouchers)
	pkg := e.pkg("Go Desk Voucher Pack", 4, 200_000, 30, nil)
	sell := "/api/gym/credits/" + c + "/sell"

	// The desk checks the code first.
	quote := e.data(asStaff, "POST", "/api/gym/credits/"+c+"/vouchers/preview", map[string]any{"package_id": pkg, "code": "gym10"})
	if quote["discount_idr"] != 25_000.0 || quote["total_idr"] != 175_000.0 {
		t.Fatalf("desk preview %v", quote)
	}

	// The voucher comes off first, the manual discount after; the sale is
	// paid at once, so the code is captured.
	sale := e.data(asStaff, "POST", sell, map[string]any{"package_id": pkg, "payment_method": "cash", "discount_idr": 10_000, "voucher_code": "gym10"})
	saleID := sale["id"].(string)
	if sale["status"] != "paid" || sale["discount_idr"] != 35_000.0 || sale["total_idr"] != 165_000.0 || vouchers.state[saleID] != "captured" {
		t.Fatalf("desk sale %v %v", sale, vouchers.state)
	}
	if vouchers.last.PackageID != pkg {
		t.Fatalf("voucher check %+v", vouchers.last)
	}
	e.fail(asStaff, "POST", sell, map[string]any{"package_id": pkg, "payment_method": "cash", "voucher_code": "NOPE"}, 422, "Kode promo tidak dikenal")
	e.fail(asStaff, "POST", sell, map[string]any{"package_id": pkg, "payment_method": "complimentary", "voucher_code": "GYM10"}, 400,
		"Voucher tidak bisa dipakai untuk penjualan gratis")

	// A refund gives the code its use back and says so on the purchase.
	refunded := e.data(asStaff, "POST", "/api/gym/credits/purchases/"+saleID+"/refund", map[string]any{"reason": "batal beli"})
	note, _ := refunded["note"].(string)
	if refunded["status"] != "refunded" || vouchers.state[saleID] != "released" || !strings.Contains(note, "Voucher dikembalikan") {
		t.Fatalf("refund %v %v", refunded, vouchers.state)
	}
	var flagged bool
	e.scalar(&flagged, `SELECT (payment_meta->>'voucher_released')::boolean FROM gym.credit_purchases WHERE id = $1`, saleID)
	if !flagged {
		t.Fatal("voucher_released missing from payment_meta")
	}

	// Paid after it expired: the code is taken again while it has quota.
	late := func() string {
		t.Helper()
		p, err := e.svc.createPurchase(e.ctx, e.tx, purchaseInput{
			CustomerID: c, PackageID: pkg, Channel: "member_portal", PaymentMethod: "invoice", VoucherCode: "GYM10",
		})
		if err != nil {
			t.Fatal(err)
		}
		if err := e.svc.closePurchase(e.ctx, p.ID, "expired"); err != nil {
			t.Fatal(err)
		}
		if _, _, err := e.svc.markPaid(e.ctx, e.tx, p.ID, map[string]any{"xendit_invoice_status": "PAID"}); err != nil {
			t.Fatal(err)
		}
		return p.ID
	}
	recaptured := late()
	var status, lateNote, outcome string
	var total float64
	e.scalar(&status, `SELECT status FROM gym.credit_purchases WHERE id = $1`, recaptured)
	e.scalar(&lateNote, `SELECT note FROM gym.credit_purchases WHERE id = $1`, recaptured)
	if status != "paid" || vouchers.state[recaptured] != "captured" || lateNote != "Voucher dipakai lagi karena pembayaran terlambat" {
		t.Fatalf("recaptured %s %q %v", status, lateNote, vouchers.state[recaptured])
	}

	// Without quota the member keeps the discount they paid and the purchase logs it.
	vouchers.quotaUsed = true
	kept := late()
	e.scalar(&outcome, `SELECT payment_meta->>'voucher_late_payment' FROM gym.credit_purchases WHERE id = $1`, kept)
	e.scalar(&total, `SELECT total_idr::float FROM gym.credit_purchases WHERE id = $1`, kept)
	if outcome != "quota_used" || total != 175_000 || vouchers.state[kept] != "released" {
		t.Fatalf("quota used: %q total %v state %v", outcome, total, vouchers.state[kept])
	}

	// A campaign switched off or past its dates by payment time: the same.
	vouchers.quotaUsed, vouchers.closed = false, true
	closed := late()
	e.scalar(&outcome, `SELECT payment_meta->>'voucher_late_payment' FROM gym.credit_purchases WHERE id = $1`, closed)
	e.scalar(&lateNote, `SELECT note FROM gym.credit_purchases WHERE id = $1`, closed)
	e.scalar(&total, `SELECT total_idr::float FROM gym.credit_purchases WHERE id = $1`, closed)
	if outcome != "campaign_closed" || total != 175_000 || vouchers.state[closed] != "released" || !strings.Contains(lateNote, "tidak aktif atau di luar masa berlaku") {
		t.Fatalf("campaign closed: %q %q total %v state %v", outcome, lateNote, total, vouchers.state[closed])
	}
}
