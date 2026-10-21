package gymcredits

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"nuhabit/backend/internal/platform/database"
)

// fakeVouchers knows the code GYM10 and tracks each purchase's hold.
type fakeVouchers struct {
	discount  float64
	state     map[string]string // purchase id -> held | captured | released
	last      VoucherCheck
	quotaUsed bool
	closed    bool
}

func (f *fakeVouchers) quote(in VoucherCheck) VoucherQuote {
	f.last = in
	if !strings.EqualFold(in.Code, "GYM10") {
		return VoucherQuote{Message: "Kode promo tidak dikenal"}
	}
	return VoucherQuote{OK: true, Discount: min(f.discount, in.Subtotal), Label: "Gym promo"}
}

func (f *fakeVouchers) Preview(_ context.Context, _ database.Querier, in VoucherCheck) (VoucherQuote, error) {
	return f.quote(in), nil
}

func (f *fakeVouchers) Hold(_ context.Context, _ database.Querier, in VoucherCheck, purchaseID string) (VoucherQuote, error) {
	q := f.quote(in)
	if q.OK {
		f.state[purchaseID] = "held"
	}
	return q, nil
}

func (f *fakeVouchers) Capture(_ context.Context, _ database.Querier, purchaseID string) error {
	if f.state[purchaseID] == "held" {
		f.state[purchaseID] = "captured"
	}
	return nil
}

func (f *fakeVouchers) Release(_ context.Context, _ database.Querier, purchaseID string) (bool, error) {
	if f.state[purchaseID] == "" || f.state[purchaseID] == "released" {
		return false, nil
	}
	f.state[purchaseID] = "released"
	return true, nil
}

// Recapture takes a released code again unless closed or quotaUsed is set.
func (f *fakeVouchers) Recapture(_ context.Context, _ database.Querier, purchaseID string) (VoucherRecapture, error) {
	if f.state[purchaseID] != "released" {
		return RecaptureNone, nil
	}
	switch {
	case f.closed:
		return RecaptureCampaignClosed, nil
	case f.quotaUsed:
		return RecaptureQuotaUsed, nil
	}
	f.state[purchaseID] = "captured"
	return RecaptureCaptured, nil
}

func TestVoucherOnPackagePurchases(t *testing.T) {
	invoices := map[string]string{} // invoice id -> status
	amounts := []float64{}
	xendit := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "POST" && r.URL.Path == "/v2/invoices" {
			var body map[string]any
			_ = json.NewDecoder(r.Body).Decode(&body)
			amounts = append(amounts, body["amount"].(float64))
			id := fmt.Sprintf("inv_voucher_%d", len(amounts))
			invoices[id] = "PENDING"
			_ = json.NewEncoder(w).Encode(map[string]any{"id": id, "invoice_url": "https://checkout.test/" + id, "expiry_date": "2030-01-01T00:00:00.000Z"})
			return
		}
		id := strings.TrimPrefix(r.URL.Path, "/v2/invoices/")
		_ = json.NewEncoder(w).Encode(map[string]any{"id": id, "status": invoices[id]})
	}))
	defer xendit.Close()
	t.Setenv("XENDIT_API_BASE_URL", xendit.URL)
	t.Setenv("XENDIT_SECRET_KEY", "xnd_test")
	t.Setenv("XENDIT_MOCK", "")

	e := setup(t)
	const preview = "/api/member-portal/gym/credits/vouchers/preview"
	const purchases = "/api/member-portal/gym/credits/purchases"
	pkg := e.pkg("Go Voucher Pack", 4, 200_000, 30, nil)

	// Without the promo engine wired, codes are turned away.
	e.fail(asMember, "POST", preview, map[string]any{"package_id": pkg, "code": "GYM10"}, 422,
		"Kode voucher belum bisa dipakai untuk paket kelas")

	vouchers := &fakeVouchers{discount: 25_000, state: map[string]string{}}
	e.svc.WithVouchers(vouchers)

	e.fail(asMember, "POST", preview, map[string]any{"package_id": pkg, "code": " "}, 400, "Masukkan kode voucher")
	e.fail(asMember, "POST", preview, map[string]any{"package_id": pkg, "code": "NOPE"}, 422, "Kode promo tidak dikenal")
	quote := e.data(asMember, "POST", preview, map[string]any{"package_id": pkg, "code": " gym10 "})
	if quote["code"] != "GYM10" || quote["label"] != "Gym promo" || quote["price_idr"] != 200_000.0 ||
		quote["discount_idr"] != 25_000.0 || quote["total_idr"] != 175_000.0 {
		t.Fatalf("preview %v", quote)
	}
	if vouchers.last.Phone != e.member.Phone || vouchers.last.CustomerID != e.member.CustomerID || vouchers.last.Subtotal != 200_000 {
		t.Fatalf("voucher check %+v", vouchers.last)
	}

	// ARK Coin: paid at once for the discounted total, the code captured.
	e.exec(`UPDATE pos.pos_customers SET ark_coin_balance = 500000 WHERE id = $1`, e.member.CustomerID)
	paid := e.data(asMember, "POST", purchases, map[string]any{"package_id": pkg, "method": "ark_coin", "voucher_code": "gym10"})
	if paid["status"] != "paid" || paid["total_idr"] != 175_000.0 || vouchers.state[paid["id"].(string)] != "captured" {
		t.Fatalf("ark purchase %v %v", paid, vouchers.state)
	}
	var discount float64
	e.scalar(&discount, `SELECT discount_idr::float FROM gym.credit_purchases WHERE id = $1`, paid["id"])
	if discount != 25_000 || e.arkBalance() != 325_000 {
		t.Fatalf("discount %v ark %v", discount, e.arkBalance())
	}

	// A code that does not apply stops the purchase before a row exists.
	var before, after int
	e.scalar(&before, `SELECT count(*) FROM gym.credit_purchases WHERE customer_id = $1`, e.member.CustomerID)
	e.fail(asMember, "POST", purchases, map[string]any{"package_id": pkg, "method": "invoice", "voucher_code": "NOPE"}, 422, "Kode promo tidak dikenal")
	e.scalar(&after, `SELECT count(*) FROM gym.credit_purchases WHERE customer_id = $1`, e.member.CustomerID)
	if after != before {
		t.Fatalf("purchases %d -> %d", before, after)
	}

	// Invoice: the code is held while pending and released when it expires.
	expiring := e.data(asMember, "POST", purchases, map[string]any{"package_id": pkg, "method": "invoice", "voucher_code": "GYM10"})
	expiringID := expiring["id"].(string)
	if expiring["status"] != "pending" || expiring["total_idr"] != 175_000.0 || amounts[0] != 175_000 || vouchers.state[expiringID] != "held" {
		t.Fatalf("pending %v amounts %v state %v", expiring, amounts, vouchers.state)
	}
	invoices["inv_voucher_1"] = "EXPIRED"
	if s := e.data(asMember, "GET", purchases+"/"+expiringID, nil); s["status"] != "expired" || vouchers.state[expiringID] != "released" {
		t.Fatalf("expired %v %v", s, vouchers.state)
	}

	// Invoice paid: the hold becomes final.
	settling := e.data(asMember, "POST", purchases, map[string]any{"package_id": pkg, "method": "invoice", "voucher_code": "GYM10"})
	settlingID := settling["id"].(string)
	invoices["inv_voucher_2"] = "PAID"
	if s := e.data(asMember, "GET", purchases+"/"+settlingID, nil); s["status"] != "paid" || vouchers.state[settlingID] != "captured" {
		t.Fatalf("paid %v %v", s, vouchers.state)
	}

	// A code that covers the whole price settles the purchase without a payment.
	vouchers.discount = 1_000_000
	free := e.data(asMember, "POST", purchases, map[string]any{"package_id": pkg, "method": "invoice", "voucher_code": "GYM10"})
	if free["status"] != "paid" || free["total_idr"] != 0.0 || vouchers.state[free["id"].(string)] != "captured" || len(amounts) != 2 {
		t.Fatalf("free %v %v amounts %v", free, vouchers.state, amounts)
	}
}
