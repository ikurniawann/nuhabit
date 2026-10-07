package domain

import (
	"strings"
	"testing"
)

// Ported from frontend/src/lib/purchasing/receipt-scan.test.ts.

func amount(v *float64) any {
	if v == nil {
		return nil
	}
	return *v
}

func str(v *string) any {
	if v == nil {
		return nil
	}
	return *v
}

func TestParseAmount(t *testing.T) {
	cases := map[string]any{
		"Rp 1.234.567":   float64(1_234_567),
		"1.500":          float64(1_500),
		"1.234.567,50":   float64(1_234_568),
		"1,234,567.00":   float64(1_234_567),
		"250000":         float64(250_000),
		"0":              nil,
		"abc":            nil,
		"Rp1.234.567,50": float64(1_234_568),
	}
	for in, want := range cases {
		if got := amount(ParseAmount(in)); got != want {
			t.Errorf("ParseAmount(%q) = %v, want %v", in, got, want)
		}
	}
}

func TestFindDate(t *testing.T) {
	cases := map[string]any{
		"Tanggal: 12/07/2026":     "2026-07-12",
		"tgl 5-1-26":              "2026-01-05",
		"Bandung, 12 Juli 2026":   "2026-07-12",
		"3 Agustus 2026":          "2026-08-03",
		"07/25/2026":              "2026-07-25", // 25 is no month: read as mm/dd
		"tidak ada apa-apa":       nil,
		"dibuat 2026-07-12 jam":   "2026-07-12",
		"Bandung, 12\u00a0Jul 26": "2026-07-12",
	}
	for in, want := range cases {
		if got := str(FindDate(in)); got != want {
			t.Errorf("FindDate(%q) = %v, want %v", in, got, want)
		}
	}
}

func TestFindNumber(t *testing.T) {
	cases := map[string]any{
		"No. Nota: 0123/ABC/26":           "0123/ABC/26",
		"Invoice INV-2026-0712 tanggal …": "INV-2026-0712",
		"Faktur : FKT.001.26":             "FKT.001.26",
		"No 12/07/2026":                   nil, // a bare date is no receipt number
	}
	for in, want := range cases {
		if got := str(FindNumber(in)); got != want {
			t.Errorf("FindNumber(%q) = %v, want %v", in, got, want)
		}
	}
}

func TestFindTotal(t *testing.T) {
	cases := map[string]any{
		"Subtotal 100.000\nDiskon 10.000\nTOTAL Rp 90.000": float64(90_000),
		"Total 100.000\nPPN 11.000\nGrand Total 111.000":   float64(111_000),
		"Beras 5kg 70.000\nMinyak 2L 38.000":               nil, // no keyword, no guess
	}
	for in, want := range cases {
		if got := amount(FindTotal(in)); got != want {
			t.Errorf("FindTotal(%q) = %v, want %v", in, got, want)
		}
	}
}

func TestParseReceiptText(t *testing.T) {
	text := strings.Join([]string{
		"TOKO SUMBER REZEKI",
		"Jl. Merdeka No. 12 Bandung",
		"No Nota: SR-0451",
		"Tanggal: 24/07/2026",
		"Beras 5kg        70.000",
		"Minyak 2L        38.000",
		"Gula 1kg         15.000",
		"TOTAL        Rp 123.000",
		"Tunai            150.000",
		"Kembali           27.000",
	}, "\n")
	got := ParseReceiptText(text)
	if str(got.Nomor) != "SR-0451" || str(got.Tanggal) != "2026-07-24" || amount(got.Total) != float64(123_000) {
		t.Fatalf("full receipt: %v %v %v", str(got.Nomor), str(got.Tanggal), amount(got.Total))
	}

	if empty := ParseReceiptText("  "); empty != (ReceiptFields{}) {
		t.Fatalf("blank text: %+v", empty)
	}

	partial := ParseReceiptText("nota belanja bulanan\ntotal 250.000")
	if amount(partial.Total) != float64(250_000) || partial.Nomor != nil {
		t.Fatalf("partial: %v %v", str(partial.Nomor), amount(partial.Total))
	}
}
