package domain

import (
	"math"
	"strconv"
	"strings"
	"time"
)

var shortMonthsID = [...]string{"Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"}

// WaktuWIB is toLocaleString("id-ID", {dateStyle: "medium", timeStyle:
// "short", timeZone: "Asia/Jakarta"}): "4 Okt 2026, 12.07".
func WaktuWIB(t time.Time) string {
	w := t.In(wib)
	return strconv.Itoa(w.Day()) + " " + shortMonthsID[w.Month()-1] + " " + strconv.Itoa(w.Year()) + ", " + w.Format("15.04")
}

// receiptRupiah is receipt-wa.ts rupiah: "Rp 1.250", "-Rp 5".
func receiptRupiah(v float64) string {
	sign := ""
	if v < 0 {
		sign = "-"
	}
	return sign + "Rp " + groupThousands(strconv.FormatFloat(math.Abs(RoundHalfUp(v)), 'f', 0, 64))
}

var receiptMethodLabels = map[string]string{
	"cash": "Tunai", "qris": "QRIS", "card": "Kartu", "transfer": "Transfer",
	"ark_coin": "ARK Coin", "gift_card": "Gift Card", "nfc_tab": "Tab Gelang",
}

func metodeBayar(method string) string {
	if m, ok := receiptMethodLabels[strings.ToLower(Trim(method))]; ok {
		return m
	}
	if t := Trim(method); t != "" {
		return t
	}
	return strings.ToUpper(strings.ReplaceAll(method, "_", " "))
}

// NormalizeWaPhone turns 08xx/+62/spaces into 628xx; malformed → "".
func NormalizeWaPhone(raw string) string {
	var b strings.Builder
	for _, r := range raw {
		if r >= '0' && r <= '9' {
			b.WriteRune(r)
		}
	}
	d := b.String()
	if d == "" {
		return ""
	}
	switch {
	case strings.HasPrefix(d, "0"):
		d = "62" + d[1:]
	case strings.HasPrefix(d, "62"):
	default:
		d = "62" + d
	}
	if len(d) < 11 || len(d) > 16 {
		return ""
	}
	return d
}

// ReceiptItem is one receipt line.
type ReceiptItem struct {
	Name      string
	Quantity  float64
	Total     float64
	StallName string
}

// OrderReceipt is OrderReceiptInput.
type OrderReceipt struct {
	OutletName, OrderNumber string
	OrderedAt               time.Time
	Items                   []ReceiptItem
	Total, Change, Discount float64
	PaymentMethod           string
	CustomerName            string
	FooterLines             []string
}

// BuildOrderReceiptMessage is buildOrderReceiptMessage.
func BuildOrderReceiptMessage(in OrderReceipt) string {
	lines := []string{
		"*" + in.OutletName + "* — Struk Digital",
		"No: " + in.OrderNumber,
		"Waktu: " + WaktuWIB(in.OrderedAt) + " WIB",
	}
	if in.CustomerName != "" {
		lines = append(lines, "Pelanggan: "+in.CustomerName)
	}
	lines = append(lines, "")
	line := func(it ReceiptItem) string {
		return NumberString(it.Quantity) + "x " + it.Name + " — " + receiptRupiah(it.Total)
	}
	var stalls []string
	seen := map[string]bool{}
	for _, it := range in.Items {
		if s := Trim(it.StallName); s != "" && !seen[s] {
			seen[s] = true
			stalls = append(stalls, s)
		}
	}
	if len(stalls) > 1 {
		for _, s := range stalls {
			lines = append(lines, "_"+s+"_")
			for _, it := range in.Items {
				if Trim(it.StallName) == s {
					lines = append(lines, line(it))
				}
			}
		}
		for _, it := range in.Items {
			if Trim(it.StallName) == "" {
				lines = append(lines, line(it))
			}
		}
	} else {
		for _, it := range in.Items {
			lines = append(lines, line(it))
		}
	}
	lines = append(lines, "")
	if in.Discount > 0 {
		lines = append(lines, "Diskon: "+receiptRupiah(in.Discount))
	}
	lines = append(lines, "*Total: "+receiptRupiah(in.Total)+"*", "Pembayaran: "+metodeBayar(in.PaymentMethod))
	if in.Change > 0 {
		lines = append(lines, "Kembalian: "+receiptRupiah(in.Change))
	}
	footer := in.FooterLines
	if len(footer) == 0 {
		footer = []string{"Terima kasih atas kunjungan Anda 🙏"}
	}
	lines = append(lines, "")
	lines = append(lines, footer...)
	return strings.Join(lines, "\n")
}

var paymentMethodLabels = map[string]string{
	"cash": "Tunai", "qris": "QRIS", "credit": "Kartu", "credit_card": "Kartu", "debit": "Kartu debit",
	"ark_coin": "ARK Coin", "nfc_tab": "NFC Tab", "member_bill": "Tagihan Member", "gift_card": "Gift card",
}

var builtinMethodCodes = map[string]bool{"cash": true, "qris": true, "credit_card": true, "ark_coin": true, "nfc_tab": true, "gift_card": true}

// FormatPaymentMethodLabel is reports/transaction-labels.ts formatPaymentMethodLabel.
func FormatPaymentMethodLabel(method, catalogCode, catalogName string) string {
	code := strings.ToLower(Trim(catalogCode))
	name := Trim(catalogName)
	if name != "" && code != "" && !builtinMethodCodes[code] {
		return name
	}
	v := strings.ToLower(Trim(method))
	if v == "" {
		if name != "" {
			return name
		}
		return "—"
	}
	if l, ok := paymentMethodLabels[v]; ok {
		return l
	}
	if method != "" {
		return method
	}
	return "—"
}

// NormalizeReceiptLines keeps trimmed non-empty strings, at most 6 lines of
// 42 UTF-16 units.
func NormalizeReceiptLines(raw any) []string {
	list, _ := raw.([]any)
	out := []string{}
	for _, v := range list {
		s, ok := v.(string)
		if !ok {
			continue
		}
		if s = Trim(s); s == "" {
			continue
		}
		if len(out) == 6 {
			break
		}
		out = append(out, truncateUTF16(s, 42))
	}
	return out
}
