package domain

import (
	"strings"
	"testing"
	"time"
)

// payment-guards.test.ts
const validUID = "04A1B2C3D4E5F6"

func TestNormalizeNfcUID(t *testing.T) {
	cases := map[string]string{
		"  04:a1-b2 c3  ": "04A1B2C3",
		" :- ":            "",
		"zz":              "",
		"04a1b2c3d4e5f6":  validUID,
	}
	for in, want := range cases {
		if got := NormalizeNfcUID(in); got != want {
			t.Errorf("NormalizeNfcUID(%q) = %q, want %q", in, got, want)
		}
	}
	if IsValidNfcUID("1234567") || !IsValidNfcUID("12345678") || !IsValidNfcUID(strings.Repeat("A", 64)) || IsValidNfcUID(strings.Repeat("A", 65)) {
		t.Errorf("IsValidNfcUID bounds wrong")
	}
}

func TestGuardBalancePayment(t *testing.T) {
	base := BalancePaymentInput{PaymentMethod: "cash", VenueCompanyID: "c1", VenueBranchID: "b1"}
	with := func(mod func(*BalancePaymentInput)) BalancePaymentInput {
		in := base
		mod(&in)
		return in
	}
	cases := []struct {
		name string
		in   BalancePaymentInput
		want string
	}{
		{"cash passes", base, ""},
		{"NFC needs tap", with(func(in *BalancePaymentInput) { in.PaymentMethod = "nfc_tab" }), "Pembayaran NFC Tab membutuhkan tap gelang"},
		{"invalid UID", with(func(in *BalancePaymentInput) { in.PaymentMethod = "nfc_tab"; in.NfcTabUID = "zz" }), "UID gelang tidak valid — tap ulang gelang"},
		{"NFC with ARK", with(func(in *BalancePaymentInput) { in.PaymentMethod = "nfc_tab"; in.NfcTabUID = validUID; in.ArkUsed = 1 }), "NFC Tab tidak bisa dicampur ARK Coin — 1 transaksi 1 metode"},
		{"valid NFC", with(func(in *BalancePaymentInput) { in.PaymentMethod = "nfc_tab"; in.NfcTabUID = validUID }), ""},
		{"band checked before ARK", with(func(in *BalancePaymentInput) { in.PaymentMethod = "nfc_tab"; in.ArkUsed = 5 }), "Pembayaran NFC Tab membutuhkan tap gelang"},
		{"gift card code", with(func(in *BalancePaymentInput) { in.PaymentMethod = "gift_card" }), "Pembayaran gift card membutuhkan kode kartu"},
		{"gift with ARK before venue", with(func(in *BalancePaymentInput) {
			in.PaymentMethod = "gift_card"
			in.GiftCardCode = "GC-1"
			in.ArkUsed = 1
			in.VenueCompanyID, in.VenueBranchID = "", ""
		}), "Gift card tidak bisa dicampur ARK Coin — 1 transaksi 1 metode"},
		{"gift needs venue", with(func(in *BalancePaymentInput) {
			in.PaymentMethod = "gift_card"
			in.GiftCardCode = "GC-1"
			in.VenueBranchID = ""
		}), "Venue belum dikonfigurasi — gift card tidak bisa dipakai"},
		{"cash buys gift card", with(func(in *BalancePaymentInput) { in.SellsGiftCard = true }), ""},
		{"method error before sale error", with(func(in *BalancePaymentInput) { in.PaymentMethod = "gift_card"; in.SellsGiftCard = true }), "Pembayaran gift card membutuhkan kode kartu"},
	}
	for _, method := range []string{"gift_card", "nfc_tab", "ark_coin"} {
		cases = append(cases, struct {
			name string
			in   BalancePaymentInput
			want string
		}{"buy gift card with " + method, with(func(in *BalancePaymentInput) {
			in.PaymentMethod = method
			in.NfcTabUID = validUID
			in.GiftCardCode = "GC-1"
			in.SellsGiftCard = true
		}), "Gift card harus dibeli dengan pembayaran tunai/kartu/QRIS, bukan saldo"})
	}
	for _, c := range cases {
		got := GuardBalancePayment(c.in)
		assertRejection(t, c.name, got, c.want)
	}
}

func assertRejection(t *testing.T, name string, got *Rejection, want string) {
	t.Helper()
	if want == "" {
		if got != nil {
			t.Errorf("%s: unexpected rejection %+v", name, *got)
		}
		return
	}
	if got == nil || got.Status != 400 || got.Message != want {
		t.Errorf("%s: got %+v, want 400 %q", name, got, want)
	}
}

func TestGuardFocRequest(t *testing.T) {
	assertRejection(t, "customer first", GuardFocRequest("", ""), "Metode FOC membutuhkan customer/member — pilih customer dulu")
	assertRejection(t, "PIN required", GuardFocRequest("c", ""), "Metode FOC membutuhkan PIN supervisor")
	assertRejection(t, "passes", GuardFocRequest("c", "1234"), "")
}

func TestGuardSettlement(t *testing.T) {
	cases := []struct {
		name      string
		method    string
		foc       bool
		paid, ark float64
		customer  string
		want      string
	}{
		{"exact cash", "cash", false, 100000, 0, "cust-1", ""},
		{"insufficient", "cash", false, 99999, 0, "cust-1", "Payment insufficient"},
		{"nfc skips sufficiency", "nfc_tab", false, 0, 0, "cust-1", ""},
		{"gift skips sufficiency", "gift_card", false, 0, 0, "cust-1", ""},
		{"FOC skips sufficiency", "cash", true, 0, 0, "cust-1", ""},
		{"ARK mixed", "cash", false, 100000, 1000, "cust-1", "ARK Coin tidak bisa dicampur metode lain — 1 transaksi 1 metode pembayaran"},
		{"ARK needs customer", "ark_coin", false, 0, 100000, "", "Pembayaran ARK Coin membutuhkan customer"},
		{"ARK covers total", "ark_coin", false, 50000, 50000, "cust-1", "Pembayaran ARK Coin harus menutup seluruh total order"},
		{"sufficiency before ARK", "ark_coin", false, 0, 10, "cust-1", "Payment insufficient"},
		{"full ARK", "ark_coin", false, 0, 100000, "cust-1", ""},
	}
	for _, c := range cases {
		assertRejection(t, c.name, GuardSettlement(c.method, c.foc, c.paid, c.ark, 100000, c.customer), c.want)
	}
}

func TestGuardCompRequest(t *testing.T) {
	cases := []struct {
		name     string
		comp     any
		customer string
		total    float64
		wantComp string
		want     string
	}{
		{"undefined", Undefined{}, "", 5, "", ""},
		{"null", nil, "", 5, "", ""},
		{"empty", "", "", 5, "", ""},
		{"owner_comp rejected", "owner_comp", "c", 0, "", "comp_type tidak dikenal utk pembuatan order (owner_comp hanya via pelunasan open bill)"},
		{"KOL needs customer", "kol_comp", "", 0, "", "Komplimen KOL membutuhkan customer"},
		{"KOL must be free", "kol_comp", "c", 0.51, "", "Komplimen KOL harus menggratiskan seluruh order (total 0)"},
		{"KOL within tolerance", "kol_comp", "c", 0.5, KolComp, ""},
		{"false is unknown", false, "c", 0, "", "comp_type tidak dikenal utk pembuatan order (owner_comp hanya via pelunasan open bill)"},
		{"array String()s to kol_comp", []any{"kol_comp"}, "c", 0, KolComp, ""},
	}
	for _, c := range cases {
		comp, rej := GuardCompRequest(c.comp, c.customer, c.total)
		if comp != c.wantComp {
			t.Errorf("%s: comp = %q, want %q", c.name, comp, c.wantComp)
		}
		assertRejection(t, c.name, rej, c.want)
	}
}

// comp-orders.test.ts
func TestKolQuotaAllows(t *testing.T) {
	if got := KolQuotaAllows(nil, 9e9, 9e9); got != "" {
		t.Errorf("unlimited quota rejected: %q", got)
	}
	if got := KolQuotaAllows(ptr(500000), 400000, 100000); got != "" {
		t.Errorf("within quota rejected: %q", got)
	}
	if got := KolQuotaAllows(ptr(500000), 400000, 100000.5); got != "" {
		t.Errorf("0.5 tolerance rejected: %q", got)
	}
	got := KolQuotaAllows(ptr(500000), 400000, 100001)
	want := "Kuota komplimen KOL bulan ini terlampaui (terpakai Rp400.000 dari Rp500.000, order ini Rp100.001)"
	if got != want {
		t.Errorf("over quota = %q, want %q", got, want)
	}
}

func TestMonthStartWIB(t *testing.T) {
	cases := []struct{ now, want string }{
		{"2026-08-23T20:00:00+07:00", "2026-07-31T17:00:00Z"},
		{"2026-08-31T17:30:00Z", "2026-08-31T17:00:00Z"},
		{"2026-01-01T00:30:00+07:00", "2025-12-31T17:00:00Z"},
	}
	for _, c := range cases {
		now, _ := time.Parse(time.RFC3339, c.now)
		if got := MonthStartWIB(now).UTC().Format(time.RFC3339); got != c.want {
			t.Errorf("MonthStartWIB(%s) = %s, want %s", c.now, got, c.want)
		}
	}
}

// payment-methods.test.ts
func TestIsFocPaymentMethod(t *testing.T) {
	cases := []struct {
		code, name string
		want       bool
	}{
		{"foc", "", true},
		{"FOC", "", true},
		{"free_of_charge", "", true},
		{"free-of-charge", "", true},
		{" freeofcharge ", "", true},
		{"", "FOC", true},
		{"", "F.O.C", true},
		{"gratis", "Free of Charge", true},
		{"", " f o c. ", true},
		{"cash", "Cash", false},
		{"qris", "QRIS", false},
		{"transfer_bca", "Transfer BCA", false},
		{"focus_pay", "Focus Pay", false},
		{"", "Kartu Officer", false},
		// JS \s matches NBSP.
		{"", "Free\u00a0of\u00a0Charge", true},
		{"", "FOC\u00a0", true},
	}
	for _, c := range cases {
		if got := IsFocPaymentMethod(c.code, c.name); got != c.want {
			t.Errorf("IsFocPaymentMethod(%q,%q) = %v, want %v", c.code, c.name, got, c.want)
		}
	}
}

func TestPaymentCatalogStamp(t *testing.T) {
	if got := ResolvePaymentCatalogStamp("Transfer BCA", "  Transfer BCA  "); got != (CatalogStamp{Code: "transfer_bca", Name: "Transfer BCA"}) {
		t.Errorf("stamp = %+v", got)
	}
	codes := map[string]string{
		"Transfer BCA":           "transfer_bca",
		"  EDC-Mandiri  ":        "edc_mandiri",
		"__x__":                  "x",
		"!!!":                    "",
		"":                       "",
		strings.Repeat("ab", 30): strings.Repeat("ab", 20),
	}
	for in, want := range codes {
		if got := SanitizePaymentMethodCode(in); got != want {
			t.Errorf("SanitizePaymentMethodCode(%q) = %q, want %q", in, got, want)
		}
	}
	nameCases := map[string]string{
		"  a   b\tc ":                "a b c",
		"":                           "",
		"   ":                        "",
		strings.Repeat("é", 90):      strings.Repeat("é", 80),
		"  Transfer\u00a0\u00a0BCA ": "Transfer BCA",
	}
	for in, want := range nameCases {
		if got := SanitizePaymentMethodName(in); got != want {
			t.Errorf("SanitizePaymentMethodName(%q) = %q, want %q", in, got, want)
		}
	}
}

// xendit-ids.test.ts
func TestSanitizeXenditRef(t *testing.T) {
	cases := map[string]string{
		"qr_abc":                 "qr_abc",
		" pos-1 ":                "pos-1",
		"":                       "",
		strings.Repeat("x", 129): "",
		strings.Repeat("x", 128): strings.Repeat("x", 128),
		// String.length counts UTF-16 units, not bytes.
		strings.Repeat("é", 100): strings.Repeat("é", 100),
	}
	for in, want := range cases {
		if got := SanitizeXenditRef(in); got != want {
			t.Errorf("SanitizeXenditRef(%q) = %q, want %q", in, got, want)
		}
	}
}

// qris-settle-guard.test.ts
func TestAssertQrisSaleMaySettle(t *testing.T) {
	cases := []struct {
		name           string
		method, qr, ex string
		used           bool
		want           string
	}{
		{"non QRIS", "cash", "", "", false, ""},
		{"no Xendit id", "qris", "", "", false, "Menunggu pembayaran QRIS"},
		{"blank ids", "qris", " ", "  ", false, "Menunggu pembayaran QRIS"},
		{"QR already used", "qris", "qr_old", "", true, "QRIS ini sudah dipakai transaksi lain"},
		{"fresh QR", "qris", "qr_new", "pos-abc", false, ""},
		{"external id only", "qris", "", "pos-abc", false, ""},
	}
	for _, c := range cases {
		if got := AssertQrisSaleMaySettle(c.method, c.qr, c.ex, c.used); got != c.want {
			t.Errorf("%s: got %q, want %q", c.name, got, c.want)
		}
	}
}

// void-order.test.ts
func TestCanVoidOrderStatus(t *testing.T) {
	cases := map[string]bool{"pending": true, "completed": true, "preparing": true, "cancelled": false, "voided": false, "merged": false, "VOIDED": false, "": true}
	for in, want := range cases {
		if got := CanVoidOrderStatus(in); got != want {
			t.Errorf("CanVoidOrderStatus(%q) = %v, want %v", in, got, want)
		}
	}
}

func TestIsPaidPosOrder(t *testing.T) {
	cases := []struct {
		status, payment string
		want            bool
	}{
		{"completed", "unpaid", true},
		{"pending", "paid", true},
		{"pending", "unpaid", false},
		{"COMPLETED", "", true},
		{"", "", false},
	}
	for _, c := range cases {
		if got := IsPaidPosOrder(c.status, c.payment); got != c.want {
			t.Errorf("IsPaidPosOrder(%q,%q) = %v, want %v", c.status, c.payment, got, c.want)
		}
	}
}

func TestArkRefundAmount(t *testing.T) {
	cases := []struct {
		name   string
		method string
		orders []VoidOrder
		wallet float64
		want   float64
	}{
		{"wallet ledger once", "ark_coin", []VoidOrder{{50000, 30000}, {0, 20000}}, 50000, 50000},
		{"largest ark_coins_used", "ark_coin", []VoidOrder{{12000, 12000}, {0, 8000}}, 0, 12000},
		{"ARK without stamp sums totals", "ark_coin", []VoidOrder{{0, 10000}, {0, 5000}}, 0, 15000},
		{"cash without ARK", "cash", []VoidOrder{{0, 10000}}, 0, 0},
		{"upper case ARK method", "ARK_COIN", []VoidOrder{{0, 7000}}, 0, 7000},
	}
	for _, c := range cases {
		if got := ArkRefundAmount(c.method, c.orders, c.wallet); got != c.want {
			t.Errorf("%s: got %v, want %v", c.name, got, c.want)
		}
	}
}

// bill-item-moves.test.ts
func TestBillBlocksItemMoves(t *testing.T) {
	cases := []struct {
		status string
		paid   float64
		want   string
	}{
		{"paid", 92500, "sudah dibayar"},
		{"partial", 10000, "sudah dibayar sebagian"},
		{"refunded", 0, "sudah di-refund"},
		{"unpaid", 5000, "sudah menerima pembayaran"},
		{"unpaid", Number("5000.00"), "sudah menerima pembayaran"},
		{"unpaid", 0, ""},
		{"", 0, ""},
		{"PAID", 0, "sudah dibayar"},
	}
	for _, c := range cases {
		if got := BillBlocksItemMoves(c.status, c.paid); got != c.want {
			t.Errorf("BillBlocksItemMoves(%q,%v) = %q, want %q", c.status, c.paid, got, c.want)
		}
	}
}

// report-dates.test.ts and parseReportDateRange (report-stall-filter.ts)
func TestTodayWIB(t *testing.T) {
	cases := map[string]string{
		"2026-08-15T17:30:00Z": "2026-08-16",
		"2026-08-31T17:30:00Z": "2026-09-01",
		"2026-08-31T16:59:59Z": "2026-08-31",
	}
	for in, want := range cases {
		now, _ := time.Parse(time.RFC3339, in)
		if got := TodayWIB(now); got != want {
			t.Errorf("TodayWIB(%s) = %s, want %s", in, got, want)
		}
	}
}

func TestParseReportDateRange(t *testing.T) {
	now, _ := time.Parse(time.RFC3339, "2026-08-15T17:30:00Z") // 16 Aug WIB
	cases := []struct {
		name, from, to   string
		wantFrom, wantTo string
		wantErr          string
	}{
		{"explicit range", "2026-09-01", "2026-09-30", "2026-09-01", "2026-09-30", ""},
		{"defaults to month to date", "", "", "2026-08-01", "2026-08-16", ""},
		{"invalid from falls back", "2026-9-1", "2026-08-10", "2026-08-01", "2026-08-10", ""},
		{"invalid to falls back", "2026-08-02", "bad", "2026-08-02", "2026-08-16", ""},
		{"from after to", "2026-09-30", "2026-09-01", "", "", "Tanggal dari tidak boleh melebihi tanggal sampai"},
	}
	for _, c := range cases {
		r, err := ParseReportDateRange(c.from, c.to, now)
		if c.wantErr != "" {
			if err == nil || err.Error() != c.wantErr {
				t.Errorf("%s: err = %v, want %q", c.name, err, c.wantErr)
			}
			continue
		}
		if err != nil || r.DateFrom != c.wantFrom || r.DateTo != c.wantTo {
			t.Errorf("%s: got %+v err=%v", c.name, r, err)
			continue
		}
		// startIso `${from}T00:00:00.000+07:00`, endIso `${to}T23:59:59.999+07:00`
		if got := r.Start.Format("2006-01-02T15:04:05.000-07:00"); got != c.wantFrom+"T00:00:00.000+07:00" {
			t.Errorf("%s: start = %s", c.name, got)
		}
		if got := r.End.Format("2006-01-02T15:04:05.000-07:00"); got != c.wantTo+"T23:59:59.999+07:00" {
			t.Errorf("%s: end = %s", c.name, got)
		}
	}
}

// list-orders.test.ts
func TestClampOrderListLimit(t *testing.T) {
	cases := []struct {
		raw     string
		present bool
		want    int
	}{
		{"all", true, 10000},
		{"", false, 50},
		{"", true, 50},
		{"abc", true, 50},
		{"0", true, 1},
		{"-5", true, 1},
		{"250", true, 250},
		{"99999", true, 10000},
		{"1e3", true, 1},
		{" 12", true, 12},
		{"12.9", true, 12},
		{"\u00a012", true, 12},
		{"+7", true, 7},
		{"-", true, 50},
		{"99999999999999999999", true, 10000},
	}
	for _, c := range cases {
		if got := ClampOrderListLimit(c.raw, c.present); got != c.want {
			t.Errorf("ClampOrderListLimit(%q,%v) = %d, want %d", c.raw, c.present, got, c.want)
		}
	}
}

func TestPaymentMethodFilter(t *testing.T) {
	cases := map[string]string{
		"credit_card": "credit",
		"qris":        "qris",
		"gift_card":   "gift_card",
		"cash":        "cash",
		"credit":      "credit",
		"ark_coin":    "ark_coin",
		"nfc_tab":     "nfc_tab",
		"bitcoin":     "",
		"":            "",
		"debit":       "",
	}
	for in, want := range cases {
		if got := PaymentMethodFilter(in); got != want {
			t.Errorf("PaymentMethodFilter(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestSanitizeOrderSearch(t *testing.T) {
	cases := map[string]string{
		"  ORD%_*12  ":                "ORD12",
		strings.Repeat("a", 100):      strings.Repeat("a", 64),
		"":                            "",
		"%%*":                         "",
		" A-01 ":                      "A-01",
		strings.Repeat("é", 64) + "x": strings.Repeat("é", 64),
	}
	for in, want := range cases {
		if got := SanitizeOrderSearch(in); got != want {
			t.Errorf("SanitizeOrderSearch(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestIsSelfOrder(t *testing.T) {
	if !IsSelfOrder("Self-service table order WIT-OFFICE-BDG; payment=cashier") || IsSelfOrder(" Self-service table order") || IsSelfOrder("") {
		t.Errorf("IsSelfOrder mismatch")
	}
}
