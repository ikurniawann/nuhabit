package domain

import (
	"fmt"
	"math"
	"regexp"
	"strings"
	"time"
)

// WhatsApp message builders of lib/pos/receipt-wa.ts used by the top-up
// receipt and the member bill reminder.

var nonDigits = regexp.MustCompile(`[^0-9]`)

// NormalizeWaPhone turns 08xx, +62 or 8xx into 628xx; nil when the result
// is not 11-16 digits.
func NormalizeWaPhone(raw *string) *string {
	if raw == nil || *raw == "" {
		return nil
	}
	digits := nonDigits.ReplaceAllString(*raw, "")
	if digits == "" {
		return nil
	}
	var n string
	switch {
	case strings.HasPrefix(digits, "0"):
		n = "62" + digits[1:]
	case strings.HasPrefix(digits, "62"):
		n = digits
	default:
		n = "62" + digits
	}
	if len(n) < 11 || len(n) > 16 {
		return nil
	}
	return &n
}

var jakarta = func() *time.Location {
	loc, err := time.LoadLocation("Asia/Jakarta")
	if err != nil {
		return time.FixedZone("WIB", 7*3600)
	}
	return loc
}()

// Jakarta is the Asia/Jakarta location.
func Jakarta() *time.Location { return jakarta }

var monthsID = []string{"Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"}

// TanggalWib is toLocaleDateString("id-ID", {dateStyle: "medium"}) in WIB:
// "4 Okt 2026".
func TanggalWib(t time.Time) string {
	w := t.In(jakarta)
	return fmt.Sprintf("%d %s %d", w.Day(), monthsID[w.Month()-1], w.Year())
}

// JamWib is toLocaleString("id-ID", {dateStyle: "medium", timeStyle:
// "short"}) in WIB: "4 Okt 2026, 10.05".
func JamWib(t time.Time) string {
	w := t.In(jakarta)
	return fmt.Sprintf("%s, %02d.%02d", TanggalWib(t), w.Hour(), w.Minute())
}

// rupiahSpaced is receipt-wa's rupiah: "Rp 10.000", "-Rp 1.500".
func rupiahSpaced(v float64) string {
	sign := ""
	if v < 0 {
		sign = "-"
	}
	return sign + "Rp " + GroupThousands(int64(JSRound(math.Abs(v))))
}

var methodLabels = map[string]string{
	"cash": "Tunai", "qris": "QRIS", "card": "Kartu", "transfer": "Transfer",
	"ark_coin": "ARK Coin", "gift_card": "Gift Card", "nfc_tab": "Tab Gelang",
}

func metodeBayar(method string) string {
	if label, has := methodLabels[strings.ToLower(strings.TrimSpace(method))]; has {
		return label
	}
	if t := strings.TrimSpace(method); t != "" {
		return t
	}
	return strings.ToUpper(strings.ReplaceAll(method, "_", " "))
}

// TopupReceipt is buildTopupReceiptMessage's input.
type TopupReceipt struct {
	OutletName   string
	CustomerName string
	Amount       float64
	Method       string
	BalanceAfter *float64
	At           time.Time
}

// BuildTopupReceiptMessage mirrors buildTopupReceiptMessage.
func BuildTopupReceiptMessage(in TopupReceipt) string {
	lines := []string{
		"*" + in.OutletName + "* — Bukti Top-Up",
		"Pelanggan: " + in.CustomerName,
		"Waktu: " + JamWib(in.At) + " WIB",
		"",
		"*Top-up: " + rupiahSpaced(in.Amount) + "*",
		"Metode: " + metodeBayar(in.Method),
	}
	if in.BalanceAfter != nil {
		lines = append(lines, "Saldo sekarang: "+rupiahSpaced(*in.BalanceAfter))
	}
	lines = append(lines, "", "Terima kasih 🙏")
	return strings.Join(lines, "\n")
}

// MemberBillWaMaxOrders is MEMBER_BILL_WA_MAX_ORDERS.
const MemberBillWaMaxOrders = 15

// BillReminderOrder is one open order line of the reminder.
type BillReminderOrder struct {
	OrderNumber string
	OrderedAt   time.Time
	Total       float64
}

// MemberBillReminder is buildMemberBillReminderMessage's input.
type MemberBillReminder struct {
	OutletName   string
	CustomerName string
	At           time.Time
	Orders       []BillReminderOrder
	OpenTotal    float64
	Paid         float64
	Outstanding  float64
}

// BuildMemberBillReminderMessage mirrors buildMemberBillReminderMessage.
func BuildMemberBillReminderMessage(in MemberBillReminder) string {
	shown := in.Orders
	if len(shown) > MemberBillWaMaxOrders {
		shown = shown[:MemberBillWaMaxOrders]
	}
	hidden := len(in.Orders) - len(shown)
	lines := []string{
		"Halo *" + in.CustomerName + "* 👋",
		"Berikut rincian tagihan Anda di *" + in.OutletName + "* per " + JamWib(in.At) + " WIB:",
		"",
	}
	for i, o := range shown {
		lines = append(lines, fmt.Sprintf("%d. %s · %s — %s", i+1, o.OrderNumber, TanggalWib(o.OrderedAt), rupiahSpaced(o.Total)))
	}
	if hidden > 0 {
		lines = append(lines, fmt.Sprintf("… dan %d order lainnya", hidden))
	}
	lines = append(lines, "", "Total order: "+rupiahSpaced(in.OpenTotal))
	if in.Paid > 0 {
		lines = append(lines, "Sudah dibayar: "+rupiahSpaced(in.Paid))
	}
	lines = append(lines, "*Sisa tagihan: "+rupiahSpaced(in.Outstanding)+"*", "",
		"Pembayaran bisa dilakukan di kasir dan boleh dicicil. Terima kasih 🙏")
	return strings.Join(lines, "\n")
}

var weekdaysID = []string{"Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"}

// FormatWib is formatWib in lib/crm/engagement/rules.ts: "Sen, 5 Okt, 15.00".
func FormatWib(t time.Time) string {
	w := t.In(jakarta)
	return fmt.Sprintf("%s, %d %s, %02d.%02d", weekdaysID[w.Weekday()], w.Day(), monthsID[w.Month()-1], w.Hour(), w.Minute())
}
