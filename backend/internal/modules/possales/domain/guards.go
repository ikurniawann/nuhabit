package domain

import (
	"errors"
	"fmt"
	"math"
	"regexp"
	"strings"
	"time"
)

// Rejection is a guard failure with its HTTP status (nil = ok).
type Rejection struct {
	Status  int
	Message string
}

func reject(status int, msg string) *Rejection { return &Rejection{Status: status, Message: msg} }

/* ── payment guards (orders/payment-guards.ts) ───────────────────────── */

// NormalizeNfcUID strips non-hex characters and upper-cases (ticketing/server.ts).
func NormalizeNfcUID(raw string) string {
	var b strings.Builder
	for _, r := range raw {
		if r >= '0' && r <= '9' || r >= 'a' && r <= 'f' || r >= 'A' && r <= 'F' {
			b.WriteRune(r)
		}
	}
	return strings.ToUpper(b.String())
}

// IsValidNfcUID: 8–64 characters after normalisation.
func IsValidNfcUID(uid string) bool { return len(uid) >= 8 && len(uid) <= 64 }

// BalancePaymentInput is guardBalancePayment's input.
type BalancePaymentInput struct {
	PaymentMethod  string
	NfcTabUID      string
	GiftCardCode   string
	ArkUsed        float64
	VenueCompanyID string
	VenueBranchID  string
	SellsGiftCard  bool
}

// GuardBalancePayment checks NFC Tab and gift card tenders.
func GuardBalancePayment(in BalancePaymentInput) *Rejection {
	nfc := in.PaymentMethod == "nfc_tab"
	gift := in.PaymentMethod == "gift_card"
	if nfc {
		if in.NfcTabUID == "" {
			return reject(400, "Pembayaran NFC Tab membutuhkan tap gelang")
		}
		if !IsValidNfcUID(NormalizeNfcUID(in.NfcTabUID)) {
			return reject(400, "UID gelang tidak valid — tap ulang gelang")
		}
		if in.ArkUsed > 0 {
			return reject(400, "NFC Tab tidak bisa dicampur ARK Coin — 1 transaksi 1 metode")
		}
	}
	if gift {
		if in.GiftCardCode == "" {
			return reject(400, "Pembayaran gift card membutuhkan kode kartu")
		}
		if in.ArkUsed > 0 {
			return reject(400, "Gift card tidak bisa dicampur ARK Coin — 1 transaksi 1 metode")
		}
		if in.VenueCompanyID == "" || in.VenueBranchID == "" {
			return reject(400, "Venue belum dikonfigurasi — gift card tidak bisa dipakai")
		}
	}
	if in.SellsGiftCard && (gift || nfc || in.PaymentMethod == "ark_coin") {
		return reject(400, "Gift card harus dibeli dengan pembayaran tunai/kartu/QRIS, bukan saldo")
	}
	return nil
}

// GuardFocRequest: FOC needs a customer and a supervisor PIN.
func GuardFocRequest(customerID, pin string) *Rejection {
	if customerID == "" {
		return reject(400, "Metode FOC membutuhkan customer/member — pilih customer dulu")
	}
	if pin == "" {
		return reject(400, "Metode FOC membutuhkan PIN supervisor")
	}
	return nil
}

// GuardSettlement checks payment sufficiency and the ARK Coin rules.
func GuardSettlement(method string, focApproved bool, paid, ark, total float64, customerID string) *Rejection {
	settled := method == "nfc_tab" || method == "gift_card" || focApproved
	if !settled && paid+ark < total {
		return reject(400, "Payment insufficient")
	}
	if ark > 0 && method != "ark_coin" {
		return reject(400, "ARK Coin tidak bisa dicampur metode lain — 1 transaksi 1 metode pembayaran")
	}
	if method == "ark_coin" {
		if customerID == "" {
			return reject(400, "Pembayaran ARK Coin membutuhkan customer")
		}
		if ark < total {
			return reject(400, "Pembayaran ARK Coin harus menutup seluruh total order")
		}
	}
	return nil
}

// GuardCompRequest validates comp_type for order creation; it returns
// "kol_comp" or "" with no rejection.
func GuardCompRequest(compType any, customerID string, total float64) (string, *Rejection) {
	if IsNullish(compType) || String(compType) == "" {
		return "", nil
	}
	if String(compType) != KolComp {
		return "", reject(400, "comp_type tidak dikenal utk pembuatan order (owner_comp hanya via pelunasan open bill)")
	}
	if customerID == "" {
		return "", reject(400, "Komplimen KOL membutuhkan customer")
	}
	if total > 0.5 {
		return "", reject(400, "Komplimen KOL harus menggratiskan seluruh order (total 0)")
	}
	return KolComp, nil
}

/* ── comp orders (comp-orders.ts) ────────────────────────────────────── */

// Comp types.
const (
	KolComp   = "kol_comp"
	OwnerComp = "owner_comp"
	FocComp   = "foc_comp"
)

// KolQuotaAllows returns "" when the monthly KOL quota allows the order.
func KolQuotaAllows(limit *float64, used, gross float64) string {
	if limit == nil {
		return ""
	}
	if used+gross <= *limit+0.5 {
		return ""
	}
	return fmt.Sprintf("Kuota komplimen KOL bulan ini terlampaui (terpakai %s dari %s, order ini %s)",
		FormatRupiah(used), FormatRupiah(*limit), FormatRupiah(gross))
}

// MonthStartWIB is the start of the current month in WIB.
func MonthStartWIB(now time.Time) time.Time {
	wib := now.UTC().Add(7 * time.Hour)
	return time.Date(wib.Year(), wib.Month(), 1, 0, 0, 0, 0, time.FixedZone("WIB", 7*3600))
}

/* ── payment methods (payment-methods.ts) ────────────────────────────── */

const jsSpace = `[\s\p{Zs}\x{2028}\x{2029}\x{FEFF}]`

var (
	focCodePattern = regexp.MustCompile(`^foc$|^free[_-]?of[_-]?charge$`)
	// jsSpace is JS \s: Unicode spaces plus the BOM (RE2 \s is ASCII only).
	focNamePattern = regexp.MustCompile(`(?i)^` + jsSpace + `*f\.?` + jsSpace + `?o\.?` + jsSpace + `?c\.?` + jsSpace + `*$|free` + jsSpace + `*of` + jsSpace + `*charge`)
	slugInvalid    = regexp.MustCompile(`[^a-z0-9]+`)
	spaces         = regexp.MustCompile(jsSpace + `+`)
)

// IsFocPaymentMethod matches the FOC custom method by code or name.
func IsFocPaymentMethod(code, name string) bool {
	c := strings.ToLower(Trim(code))
	if c != "" && focCodePattern.MatchString(c) {
		return true
	}
	return name != "" && focNamePattern.MatchString(name)
}

// SanitizePaymentMethodCode slugifies the catalog code ("" = null).
func SanitizePaymentMethodCode(v string) string {
	s := slugInvalid.ReplaceAllString(strings.ToLower(Trim(v)), "_")
	s = strings.Trim(s, "_")
	if len(s) > 40 {
		s = s[:40]
	}
	return s
}

// SanitizePaymentMethodName collapses spaces, max 80 UTF-16 units ("" = null).
func SanitizePaymentMethodName(v string) string {
	s := spaces.ReplaceAllString(Trim(v), " ")
	return truncateUTF16(s, 80)
}

func truncateUTF16(s string, max int) string {
	n := 0
	for i, r := range s {
		w := 1
		if r > 0xFFFF {
			w = 2
		}
		if n+w > max {
			return s[:i]
		}
		n += w
	}
	return s
}

// CatalogStamp is resolvePaymentCatalogStamp ("" = null).
type CatalogStamp struct {
	Code string
	Name string
}

// ResolvePaymentCatalogStamp sanitizes the cashier's catalog method.
func ResolvePaymentCatalogStamp(code, name string) CatalogStamp {
	return CatalogStamp{Code: SanitizePaymentMethodCode(code), Name: SanitizePaymentMethodName(name)}
}

/* ── QRIS (xendit-ids.ts, qris-settle-guard.ts) ──────────────────────── */

// SanitizeXenditRef trims; blank or longer than 128 is "" (null).
func SanitizeXenditRef(v string) string {
	t := Trim(v)
	if t == "" || utf16Len(t) > 128 {
		return ""
	}
	return t
}

// AssertQrisSaleMaySettle returns "" when a QRIS sale may be marked paid.
func AssertQrisSaleMaySettle(method, qrID, externalID string, alreadyUsed bool) string {
	if method != "qris" {
		return ""
	}
	if Trim(qrID) == "" && Trim(externalID) == "" {
		return "Menunggu pembayaran QRIS"
	}
	if alreadyUsed {
		return "QRIS ini sudah dipakai transaksi lain"
	}
	return ""
}

/* ── void and bill moves (void-order.ts, bill-item-moves.ts) ─────────── */

// CanVoidOrderStatus: everything but cancelled, voided, merged.
func CanVoidOrderStatus(status string) bool {
	switch strings.ToLower(status) {
	case "cancelled", "voided", "merged":
		return false
	}
	return true
}

// IsPaidPosOrder: completed or paid.
func IsPaidPosOrder(status, paymentStatus string) bool {
	return strings.ToLower(status) == "completed" || strings.ToLower(paymentStatus) == "paid"
}

// VoidOrder is the slice of a voided order the refund rules read.
type VoidOrder struct {
	ArkCoinsUsed float64
	TotalAmount  float64
}

// ArkRefundAmount: wallet payment → largest ark_coins_used → sum when ARK.
func ArkRefundAmount(paymentMethod string, orders []VoidOrder, walletPayment float64) float64 {
	if walletPayment > 0 {
		return walletPayment
	}
	maxUsed := 0.0
	for _, o := range orders {
		if o.ArkCoinsUsed > maxUsed {
			maxUsed = o.ArkCoinsUsed
		}
	}
	if maxUsed > 0 {
		return maxUsed
	}
	if strings.ToLower(paymentMethod) == "ark_coin" {
		sum := 0.0
		for _, o := range orders {
			sum += o.TotalAmount
		}
		return sum
	}
	return 0
}

// BillBlocksItemMoves returns the reason a paid bill is locked ("" = free).
func BillBlocksItemMoves(paymentStatus string, amountPaid float64) string {
	switch strings.ToLower(paymentStatus) {
	case "paid":
		return "sudah dibayar"
	case "partial":
		return "sudah dibayar sebagian"
	case "refunded":
		return "sudah di-refund"
	}
	if Or0(amountPaid) > 0 {
		return "sudah menerima pembayaran"
	}
	return ""
}

/* ── order list filters (orders/list-orders.ts) ──────────────────────── */

// ReportRange is parseReportDateRange's result.
type ReportRange struct {
	DateFrom, DateTo string
	Start, End       time.Time
}

var isoDate = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)

var wib = time.FixedZone("WIB", 7*3600)

// TodayWIB is the WIB calendar date.
func TodayWIB(now time.Time) string { return now.In(wib).Format("2006-01-02") }

// ErrDateOutOfRange is a well-formed but impossible calendar date.
var ErrDateOutOfRange = errors.New("date/time field value out of range")

// ParseReportDateRange defaults to month-to-date (WIB) and rejects from > to.
func ParseReportDateRange(from, to string, now time.Time) (ReportRange, error) {
	today := TodayWIB(now)
	if !isoDate.MatchString(from) {
		from = today[:8] + "01"
	}
	if !isoDate.MatchString(to) {
		to = today
	}
	if from > to {
		return ReportRange{}, fmt.Errorf("Tanggal dari tidak boleh melebihi tanggal sampai")
	}
	start, err1 := time.ParseInLocation("2006-01-02", from, wib)
	end, err2 := time.ParseInLocation("2006-01-02", to, wib)
	if err1 != nil || err2 != nil {
		// "2026-02-31" passes the TS regex and fails later in PostgreSQL.
		return ReportRange{DateFrom: from, DateTo: to}, ErrDateOutOfRange
	}
	return ReportRange{DateFrom: from, DateTo: to, Start: start, End: end.Add(24*time.Hour - time.Millisecond)}, nil
}

// ClampOrderListLimit: "all" = 10 000, else 1..10 000, default 50.
func ClampOrderListLimit(raw string, present bool) int {
	if raw == "all" {
		return 10000
	}
	if !present || raw == "" {
		raw = "50"
	}
	n, ok := parseIntPrefix(raw)
	if !ok {
		return 50
	}
	return int(math.Min(math.Max(float64(n), 1), 10000))
}

// parseIntPrefix mirrors parseInt(raw, 10).
func parseIntPrefix(s string) (int, bool) {
	s = Trim(s)
	sign := 1
	if strings.HasPrefix(s, "-") {
		sign, s = -1, s[1:]
	} else if strings.HasPrefix(s, "+") {
		s = s[1:]
	}
	d := leadingDigits(s)
	if d == "" {
		return 0, false
	}
	if len(d) > 15 {
		return sign * 1e15, true
	}
	n := 0
	for _, c := range d {
		n = n*10 + int(c-'0')
	}
	return sign * n, true
}

// PaymentMethodFilter keeps known methods; credit_card is stored as credit.
func PaymentMethodFilter(raw string) string {
	switch raw {
	case "cash", "qris", "credit", "ark_coin", "nfc_tab", "gift_card":
		return raw
	case "credit_card":
		return "credit"
	}
	return ""
}

// SanitizeOrderSearch drops %_* wildcards, max 64 UTF-16 units.
func SanitizeOrderSearch(raw string) string {
	s := strings.NewReplacer("%", "", "_", "", "*", "").Replace(Trim(raw))
	return truncateUTF16(s, 64)
}

// IsSelfOrder: special_requests starts with the table self-order prefix.
func IsSelfOrder(specialRequests string) bool {
	return strings.HasPrefix(specialRequests, "Self-service table order")
}

// utf16Len is JS String.length.
func utf16Len(s string) int {
	n := 0
	for _, r := range s {
		n++
		if r > 0xFFFF {
			n++
		}
	}
	return n
}
