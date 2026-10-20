package gymcredits

import (
	"net/http"
	"testing"
)

// Member-facing failures carry a stable code next to the unchanged
// Indonesian text, so the member app can show them in English too.
func TestMemberErrorCodes(t *testing.T) {
	e := setup(t)
	limit := 1
	pkg := e.pkg("Go Codes", 2, 100_000, 30, &limit)
	e.exec(`UPDATE pos.pos_customers SET ark_coin_balance = 50000 WHERE id = $1`, e.member.CustomerID)

	short := e.fail(asMember, "POST", "/api/member-portal/gym/credits/purchases", map[string]any{"package_id": pkg, "method": "ark_coin"},
		http.StatusConflict, "Saldo ARK Coin tidak cukup")
	if short["code"] != "ARK_INSUFFICIENT" {
		t.Fatalf("ark short %v", short)
	}

	e.buy(pkg)
	limited := e.fail(asMember, "POST", "/api/member-portal/gym/credits/purchases", map[string]any{"package_id": pkg, "method": "ark_coin"},
		http.StatusConflict, "Batas pembelian paket ini per member sudah tercapai.")
	if limited["code"] != "PURCHASE_LIMIT_REACHED" {
		t.Fatalf("limit %v", limited)
	}

	missing := e.fail(asMember, "POST", "/api/member-portal/gym/passes/6f1c2a1e-0d7b-4c55-9a43-1b0b6a0f5e11/freeze", map[string]any{"days": 7},
		http.StatusNotFound, "Pass tidak ditemukan")
	if missing["code"] != "PASS_NOT_FOUND" {
		t.Fatalf("pass %v", missing)
	}

	// Staff routes keep the text and gain the same codes.
	staff := e.fail(asStaff, "POST", "/api/gym/passes/6f1c2a1e-0d7b-4c55-9a43-1b0b6a0f5e11/unfreeze", nil, http.StatusNotFound, "Pass tidak ditemukan")
	if staff["code"] != "PASS_NOT_FOUND" {
		t.Fatalf("staff %v", staff)
	}
}

func TestVoucherRejectionCode(t *testing.T) {
	quote := VoucherQuote{Message: "Kuota kode promo sudah habis", Reason: "kuota-habis"}
	err := voucherRejected(quote).(*Error)
	if err.Code != "VOUCHER_KUOTA_HABIS" || err.Message != quote.Message || err.Status != http.StatusUnprocessableEntity {
		t.Fatalf("rejected %+v", err)
	}
	if bare := voucherRejected(VoucherQuote{Message: "x"}).(*Error); bare.Code != "VOUCHER_REJECTED" {
		t.Fatalf("no reason %+v", bare)
	}
}
