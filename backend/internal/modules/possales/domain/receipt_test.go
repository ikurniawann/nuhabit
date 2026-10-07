package domain

import (
	"reflect"
	"strings"
	"testing"
	"time"
)

// receipt-wa.test.ts
func TestNormalizeWaPhone(t *testing.T) {
	cases := map[string]string{
		"081234567890":      "6281234567890",
		"+62 812-3456-7890": "6281234567890",
		"0812":              "",
		"":                  "",
		"8123456789":        "628123456789",
		"62812345678901234": "",
		"abc":               "",
	}
	for in, want := range cases {
		if got := NormalizeWaPhone(in); got != want {
			t.Errorf("NormalizeWaPhone(%q) = %q, want %q", in, got, want)
		}
	}
}

func mustTime(t *testing.T, s string) time.Time {
	t.Helper()
	v, err := time.Parse(time.RFC3339, s)
	if err != nil {
		t.Fatal(err)
	}
	return v
}

func receiptBase(t *testing.T) OrderReceipt {
	return OrderReceipt{
		OutletName:    "Sulu",
		OrderNumber:   "ORD-001",
		OrderedAt:     mustTime(t, "2026-08-14T12:30:00+07:00"),
		Items:         []ReceiptItem{{Name: "Kopi Susu", Quantity: 2, Total: 36000}, {Name: "Croissant", Quantity: 1, Total: 28000}},
		Total:         64000,
		PaymentMethod: "cash",
		Change:        6000,
	}
}

func TestBuildOrderReceiptMessage(t *testing.T) {
	base := receiptBase(t)

	// Exact strings produced by node running receipt-wa.ts.
	t.Run("exact single-stall receipt", func(t *testing.T) {
		want := "*Sulu* — Struk Digital\nNo: ORD-001\nWaktu: 14 Agu 2026, 12.30 WIB\n\n2x Kopi Susu — Rp 36.000\n1x Croissant — Rp 28.000\n\n*Total: Rp 64.000*\nPembayaran: Tunai\nKembalian: Rp 6.000\n\nTerima kasih atas kunjungan Anda 🙏"
		if got := BuildOrderReceiptMessage(base); got != want {
			t.Errorf("got\n%q\nwant\n%q", got, want)
		}
	})

	t.Run("exact mixed receipt", func(t *testing.T) {
		in := OrderReceipt{
			OutletName: "Sulu", OrderNumber: "CHK-1", OrderedAt: mustTime(t, "2026-10-03T17:05:00Z"),
			CustomerName: "Budi", Discount: 5000,
			Items: []ReceiptItem{
				{Name: "Cofe Peach", Quantity: 1, Total: 36000, StallName: "Yakitori Stall"},
				{Name: "Gyoza", Quantity: 2.5, Total: 40000.5, StallName: " Dumpling Stall "},
				{Name: "Item Lama", Quantity: 1, Total: -10000},
				{Name: "Sate", Quantity: 1, Total: 1000, StallName: "Yakitori Stall"},
			},
			Total: 1234567, PaymentMethod: "credit_card", FooterLines: []string{"A", "B"},
		}
		want := "*Sulu* — Struk Digital\nNo: CHK-1\nWaktu: 4 Okt 2026, 00.05 WIB\nPelanggan: Budi\n\n_Yakitori Stall_\n1x Cofe Peach — Rp 36.000\n1x Sate — Rp 1.000\n_Dumpling Stall_\n2.5x Gyoza — Rp 40.001\n1x Item Lama — -Rp 10.000\n\nDiskon: Rp 5.000\n*Total: Rp 1.234.567*\nPembayaran: credit_card\n\nA\nB"
		if got := BuildOrderReceiptMessage(in); got != want {
			t.Errorf("got\n%q\nwant\n%q", got, want)
		}
	})

	t.Run("exact edge receipts", func(t *testing.T) {
		in := OrderReceipt{OutletName: "S", OrderNumber: "N", OrderedAt: mustTime(t, "2026-01-05T01:02:00Z"), PaymentMethod: "  "}
		want := "*S* — Struk Digital\nNo: N\nWaktu: 5 Jan 2026, 08.02 WIB\n\n\n*Total: Rp 0*\nPembayaran:   \n\nTerima kasih atas kunjungan Anda 🙏"
		if got := BuildOrderReceiptMessage(in); got != want {
			t.Errorf("got\n%q\nwant\n%q", got, want)
		}
		in = OrderReceipt{OutletName: "S", OrderNumber: "N", OrderedAt: mustTime(t, "2026-12-31T23:59:00+07:00"), Total: -0.4, PaymentMethod: " QRIS "}
		want = "*S* — Struk Digital\nNo: N\nWaktu: 31 Des 2026, 23.59 WIB\n\n\n*Total: -Rp 0*\nPembayaran: QRIS\n\nTerima kasih atas kunjungan Anda 🙏"
		if got := BuildOrderReceiptMessage(in); got != want {
			t.Errorf("got\n%q\nwant\n%q", got, want)
		}
	})

	t.Run("no change line for non-cash", func(t *testing.T) {
		in := base
		in.PaymentMethod, in.Change = "qris", 0
		msg := BuildOrderReceiptMessage(in)
		if strings.Contains(msg, "Kembalian") || !strings.Contains(strings.ToUpper(msg), "QRIS") {
			t.Errorf("msg = %q", msg)
		}
	})

	t.Run("mixed checkout groups every stall", func(t *testing.T) {
		in := base
		in.OrderNumber = "CHK-20260825-0012"
		in.Items = []ReceiptItem{
			{Name: "Cofe Peach", Quantity: 1, Total: 36000, StallName: "Yakitori Stall"},
			{Name: "Matchaaa Pistachio", Quantity: 1, Total: 36000, StallName: "Rice bowl Stall"},
			{Name: "Gyoza", Quantity: 2, Total: 40000, StallName: "Dumpling Stall"},
		}
		in.Total = 112000
		msg := BuildOrderReceiptMessage(in)
		for _, s := range []string{"_Yakitori Stall_", "_Rice bowl Stall_", "_Dumpling Stall_", "1x Cofe Peach", "1x Matchaaa Pistachio", "2x Gyoza", "Rp 112.000"} {
			if !strings.Contains(msg, s) {
				t.Errorf("missing %q in %q", s, msg)
			}
		}
	})

	t.Run("single stall stays flat", func(t *testing.T) {
		in := base
		in.Items = []ReceiptItem{{Name: "Kopi Susu", Quantity: 2, Total: 36000, StallName: "Yakitori Stall"}, {Name: "Croissant", Quantity: 1, Total: 28000, StallName: "Yakitori Stall"}}
		msg := BuildOrderReceiptMessage(in)
		if strings.Contains(msg, "_Yakitori Stall_") || !strings.Contains(msg, "2x Kopi Susu") || !strings.Contains(msg, "1x Croissant") {
			t.Errorf("msg = %q", msg)
		}
	})

	t.Run("stall-less item still printed in a mixed checkout", func(t *testing.T) {
		in := base
		in.Items = []ReceiptItem{
			{Name: "Cofe Peach", Quantity: 1, Total: 36000, StallName: "Yakitori Stall"},
			{Name: "Gyoza", Quantity: 1, Total: 20000, StallName: "Dumpling Stall"},
			{Name: "Item Lama", Quantity: 1, Total: 10000},
		}
		if msg := BuildOrderReceiptMessage(in); !strings.Contains(msg, "1x Item Lama") {
			t.Errorf("msg = %q", msg)
		}
	})

	t.Run("discount only when present", func(t *testing.T) {
		if strings.Contains(BuildOrderReceiptMessage(base), "Diskon") {
			t.Errorf("unexpected discount line")
		}
		in := base
		in.Discount = 5000
		if !strings.Contains(BuildOrderReceiptMessage(in), "Diskon") {
			t.Errorf("missing discount line")
		}
	})

	t.Run("footer follows receipt settings", func(t *testing.T) {
		if !strings.Contains(BuildOrderReceiptMessage(base), "Terima kasih atas kunjungan Anda") {
			t.Errorf("missing default footer")
		}
		in := base
		in.FooterLines = []string{"Sampai jumpa lagi!", "WiFi: SULU-GUEST"}
		msg := BuildOrderReceiptMessage(in)
		if !strings.Contains(msg, "Sampai jumpa lagi!") || !strings.Contains(msg, "WiFi: SULU-GUEST") || strings.Contains(msg, "Terima kasih atas kunjungan Anda") {
			t.Errorf("msg = %q", msg)
		}
	})
}

func TestWaktuWIB(t *testing.T) {
	cases := map[string]string{
		"2026-08-14T12:30:00+07:00": "14 Agu 2026, 12.30",
		"2026-10-03T17:05:00Z":      "4 Okt 2026, 00.05",
		"2026-05-01T00:00:00+07:00": "1 Mei 2026, 00.00",
	}
	for in, want := range cases {
		if got := WaktuWIB(mustTime(t, in)); got != want {
			t.Errorf("WaktuWIB(%s) = %q, want %q", in, got, want)
		}
	}
}

// reports/transaction-labels.test.ts
func TestFormatPaymentMethodLabel(t *testing.T) {
	cases := []struct {
		method, code, name string
		want               string
	}{
		{"qris", "", "", "QRIS"},
		{"cash", "", "", "Tunai"},
		{"credit", "", "", "Kartu"},
		{"cash", "transfer_bca", "Transfer BCA", "Transfer BCA"},
		{"cash", "cash", "Cash", "Tunai"},
		{"credit", "credit_card", "Kartu Kredit", "Kartu"},
		// "credit" is not a built-in catalog code, so a catalog name wins.
		{"credit", "credit", "Kartu BCA", "Kartu BCA"},
		{"", "", "", "—"},
		{"", "", " Nama ", "Nama"},
		{" QRIS ", "", "", "QRIS"},
		{"bitcoin", "", "", "bitcoin"},
		{"member_bill", "", "", "Tagihan Member"},
		{"debit", "", "", "Kartu debit"},
		{"cash", "transfer_bca", "", "Tunai"},
	}
	for _, c := range cases {
		if got := FormatPaymentMethodLabel(c.method, c.code, c.name); got != c.want {
			t.Errorf("FormatPaymentMethodLabel(%q,%q,%q) = %q, want %q", c.method, c.code, c.name, got, c.want)
		}
	}
}

// receipt-settings.test.ts
func TestNormalizeReceiptLines(t *testing.T) {
	if got := NormalizeReceiptLines([]any{"  BCD Coffee  ", "", 42, nil, "Dago"}); !reflect.DeepEqual(got, []string{"BCD Coffee", "Dago"}) {
		t.Errorf("got %q", got)
	}
	ten := make([]any, 10)
	for i := range ten {
		ten[i] = "baris"
	}
	if got := NormalizeReceiptLines(ten); len(got) != 6 {
		t.Errorf("line cap: %d", len(got))
	}
	if got := NormalizeReceiptLines([]any{strings.Repeat("x", 100)}); len(got[0]) != 42 {
		t.Errorf("length cap: %d", len(got[0]))
	}
	for _, in := range []any{nil, "SULU"} {
		if got := NormalizeReceiptLines(in); got == nil || len(got) != 0 {
			t.Errorf("non-array %v = %#v, want []", in, got)
		}
	}
	// slice(0, 6) runs after the blank filter, so blanks do not use up slots.
	mixed := []any{"", " ", "1", "2", "3", "4", "5", "6", "7"}
	if got := NormalizeReceiptLines(mixed); !reflect.DeepEqual(got, []string{"1", "2", "3", "4", "5", "6"}) {
		t.Errorf("got %q", got)
	}
}
