package domain

import (
	"math"
	"strconv"
	"strings"
	"time"
)

// ShiftOrder is the slice of a pos_orders row the shift close sums.
type ShiftOrder struct {
	TotalAmount       any // numeric string, number or nil
	ArkCoinsUsed      any
	PaymentMethod     string
	PaymentMethodCode *string
}

// ShiftOrderTotals is summarizeShiftOrders' result.
type ShiftOrderTotals struct {
	Cash, Qris, Debit, Credit, ArkCoin, NfcTab float64
}

// IsDrawerCashMethod mirrors isDrawerCashMethod: only the built-in "cash"
// code is drawer cash, a custom catalog code (Transfer BCA) is not.
func IsDrawerCashMethod(code *string, method string) bool {
	if code != nil {
		if c := strings.ToLower(TrimJS(*code)); c != "" {
			return c == "cash"
		}
	}
	return strings.ToLower(TrimJS(method)) == "cash"
}

// SummarizeShiftOrders totals a shift's orders per payment method. A
// "cash" order whose catalog code is not cash counts as card/credit.
func SummarizeShiftOrders(rows []ShiftOrder) ShiftOrderTotals {
	var t ShiftOrderTotals
	for _, row := range rows {
		amount := orZero(Number(row.TotalAmount))
		method := strings.ToLower(row.PaymentMethod)
		if method == "" {
			method = "cash"
		}
		if method == "cash" && !IsDrawerCashMethod(row.PaymentMethodCode, method) {
			t.Credit += amount
			continue
		}
		switch method {
		case "cash":
			t.Cash += amount
		case "qris":
			t.Qris += amount
		case "debit":
			t.Debit += amount
		case "credit":
			t.Credit += amount
		case "ark_coin":
			t.ArkCoin += orZero(Number(row.ArkCoinsUsed))
		case "nfc_tab":
			t.NfcTab += amount
		}
	}
	return t
}

// orZero is `Number(x) || 0`.
func orZero(f float64) float64 {
	if math.IsNaN(f) {
		return 0
	}
	return f
}

// MemberBillPayment is one pos_member_bill_payments row of a shift.
type MemberBillPayment struct {
	Amount            any
	PaymentMethod     *string
	PaymentMethodCode *string
}

// MemberBillShiftTotals is summarizeMemberBillShiftPayments' result.
type MemberBillShiftTotals struct {
	Cash  float64 `json:"cash"`
	Qris  float64 `json:"qris"`
	Card  float64 `json:"card"`
	Total float64 `json:"total"`
}

// SummarizeMemberBillShiftPayments splits member bill instalments taken in
// a shift: drawer cash adds to the expected cash at close.
func SummarizeMemberBillShiftPayments(rows []MemberBillPayment) MemberBillShiftTotals {
	var t MemberBillShiftTotals
	for _, row := range rows {
		amount := orZero(Number(row.Amount))
		method := ""
		if row.PaymentMethod != nil {
			method = strings.ToLower(*row.PaymentMethod)
		}
		t.Total += amount
		switch {
		case method == "cash" && IsDrawerCashMethod(row.PaymentMethodCode, method):
			t.Cash += amount
		case method == "qris":
			t.Qris += amount
		default:
			t.Card += amount
		}
	}
	return t
}

/* ── Shift report WhatsApp message (lib/pos/receipt-wa.ts) ───────────── */

// NormalizeWaPhone mirrors normalizeWaPhone: 08xx / +62 / spaces → 628xx;
// fewer than 11 or more than 16 digits is nil.
func NormalizeWaPhone(raw string) *string {
	var b strings.Builder
	for _, r := range raw {
		if r >= '0' && r <= '9' {
			b.WriteRune(r)
		}
	}
	digits := b.String()
	if digits == "" {
		return nil
	}
	var normalized string
	switch {
	case strings.HasPrefix(digits, "0"):
		normalized = "62" + digits[1:]
	case strings.HasPrefix(digits, "62"):
		normalized = digits
	default:
		normalized = "62" + digits
	}
	if len(normalized) < 11 || len(normalized) > 16 {
		return nil
	}
	return &normalized
}

// Rupiah is the receipt-wa rupiah(): "Rp 1.234.567", negatives "-Rp 5.000".
func Rupiah(v float64) string {
	sign := ""
	if v < 0 {
		sign = "-"
	}
	return sign + "Rp " + GroupThousands(math.Abs(Round(v)))
}

// GroupThousands formats a whole number with id-ID dots.
func GroupThousands(v float64) string {
	s := strconv.FormatFloat(v, 'f', 0, 64)
	neg := strings.HasPrefix(s, "-")
	s = strings.TrimPrefix(s, "-")
	var out []byte
	for i := range s {
		if i > 0 && (len(s)-i)%3 == 0 {
			out = append(out, '.')
		}
		out = append(out, s[i])
	}
	if neg {
		return "-" + string(out)
	}
	return string(out)
}

var idMonthsShort = [...]string{"Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"}

// Jakarta is Asia/Jakarta (WIB, UTC+7, no DST).
var Jakarta = func() *time.Location {
	if loc, err := time.LoadLocation("Asia/Jakarta"); err == nil {
		return loc
	}
	return time.FixedZone("WIB", 7*3600)
}()

// WibDateTime is toLocaleString("id-ID", {dateStyle: "medium",
// timeStyle: "short", timeZone: "Asia/Jakarta"}): "4 Okt 2026, 10.05".
func WibDateTime(t *time.Time) string {
	if t == nil {
		return "Invalid Date"
	}
	w := t.In(Jakarta)
	return strconv.Itoa(w.Day()) + " " + idMonthsShort[w.Month()-1] + " " + strconv.Itoa(w.Year()) +
		", " + w.Format("15.04")
}

// ShiftReport is buildShiftReportMessage's input.
type ShiftReport struct {
	OutletName, ShiftNumber, CashierName string
	OpenedAt, ClosedAt                   *time.Time
	TotalOrders                          float64
	TotalSales, OpeningCash              float64
	ExpectedCash, ClosingCash, Variance  float64
}

// ShiftReportMessage builds the WhatsApp shift close report.
func ShiftReportMessage(in ShiftReport) string {
	selisih := "pas ✅"
	switch {
	case in.Variance > 0:
		selisih = "lebih " + Rupiah(in.Variance)
	case in.Variance < 0:
		selisih = "kurang " + Rupiah(in.Variance) + " ⚠️"
	}
	return strings.Join([]string{
		"*Laporan Tutup Kasir — " + in.OutletName + "*",
		"Shift: " + in.ShiftNumber,
		"Kasir: " + in.CashierName,
		"Buka: " + WibDateTime(in.OpenedAt) + " WIB",
		"Tutup: " + WibDateTime(in.ClosedAt) + " WIB",
		"",
		"Jumlah transaksi: " + FormatNumber(in.TotalOrders),
		"*Total penjualan: " + Rupiah(in.TotalSales) + "*",
		"",
		"Kas awal: " + Rupiah(in.OpeningCash),
		"Kas seharusnya: " + Rupiah(in.ExpectedCash),
		"Kas fisik: " + Rupiah(in.ClosingCash),
		"Selisih: " + selisih,
	}, "\n")
}
