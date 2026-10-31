package salesfunnel

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"strings"
	"testing"
	"time"

	"nuhabit/backend/internal/modules/salesfunnel/domain"
	"nuhabit/backend/internal/platform/extract"
	"nuhabit/backend/internal/platform/pdfgen"
)

func renderText(t *testing.T, d *pdfgen.Doc) (string, int) {
	t.Helper()
	data, err := d.Bytes()
	if err != nil {
		t.Fatal(err)
	}
	text, err := extract.PDFText(data)
	if err != nil {
		t.Fatal(err)
	}
	return text, d.PageCount()
}

// inOrder fails unless every part appears in text, each after the previous.
func inOrder(t *testing.T, text string, parts ...string) {
	t.Helper()
	at := 0
	for _, p := range parts {
		i := strings.Index(text[at:], p)
		if i < 0 {
			t.Fatalf("%q missing after offset %d in %q", p, at, text)
		}
		at += i + len(p)
	}
}

func sp(s string) *string { return &s }

func TestQuotationPDFLayout(t *testing.T) {
	q := quotationDoc{
		docHead: docHead{Number: "QT-2610-0001", OrgName: "PT Maju", PicName: "Budi", PicTitle: sp("HR"), DealTitle: "Gathering Akhir Tahun",
			EventLabel: "Gathering", CreatedAt: "5 Oktober 2026", EventDate: "1 Desember 2026", CompanyName: sp("  "), BranchName: sp("Cabang Dago"),
			Notes: sp("Harga termasuk sound system")},
		ValidUntil: "—", UsePPN: true, PPNPersen: 11, Subtotal: 2000000, DiscountPercent: 10, DiscountNominal: 200000, PPN: 198000, Total: 1998000,
		Terms: []quotationDocTerm{{Label: "DP", Percent: 33.33, Amount: 665933.4, DueDate: ""}, {Label: "Pelunasan", Percent: 66.67, Amount: 1332066.6, DueDate: "1 Desember 2026"}},
	}
	for i := range 60 {
		q.Items = append(q.Items, quotationDocItem{Description: "Paket makan siang nomor " + pdfgen.Thousands(float64(i+1)), ItemType: "produk", Qty: 1.5, UnitPrice: 20000, LineTotal: 30000})
	}
	q.Items = append(q.Items, quotationDocItem{Description: "Sewa venue", ItemType: "jasa", Qty: 1, UnitPrice: 1000000, LineTotal: 1000000})
	text, pages := renderText(t, buildQuotationPDF(q))
	if pages < 2 {
		t.Fatalf("60 rows span pages, got %d", pages)
	}
	// An empty company name falls back to the document title; no owner
	// signs with the branch.
	inOrder(t, text, "PENAWARAN HARGA", "Cabang Dago", "QUOTATION", "Nomor : QT-2610-0001",
		"KEPADA", ":", "PT Maju", "PIC", "Budi (HR)", "ACARA", "Gathering Akhir Tahun (Gathering)",
		"TANGGAL PENAWARAN", "5 Oktober 2026", "TANGGAL ACARA", "1 Desember 2026", "BERLAKU S.D.", "—",
		"DESKRIPSI", "QTY", "HARGA", "JUMLAH", "Paket makan siang nomor 1", "1,5 pax", "Rp20.000", "Rp30.000",
		"Paket makan siang nomor 60", "Sewa venue", "1", "Rp1.000.000",
		"Subtotal", "Rp2.000.000", "Diskon 10%", "- Rp200.000", "PPN 11%", "Rp198.000", "TOTAL", "Rp1.998.000",
		"TERMIN PEMBAYARAN", "DP (33,33%)", "Rp665.933", "Pelunasan (66,67%) — jatuh tempo 1 Desember 2026", "Rp1.332.067",
		"CATATAN", "Harga termasuk sound system", "Hormat kami,", "Cabang Dago",
		"Dokumen ini dibuat otomatis oleh sistem dan sah tanpa tanda tangan basah.")
	if strings.Contains(text, "Sewa venue pax") {
		t.Fatal("only produk lines are pax")
	}
}

func TestInvoicePDFLayout(t *testing.T) {
	inv := invoiceDoc{
		docHead: docHead{Number: "INV-2610-0007", OrgName: "SD Harapan", PicName: "Ibu Sari", DealTitle: "Field trip", EventLabel: "Field Trip",
			CreatedAt: "5 Oktober 2026", EventDate: "—", CompanyName: sp("PT Nuhabit"), OwnerName: sp("Rina")},
		Label: "DP 50%", DueDate: "20 Oktober 2026", Amount: 5550000, Paid: 6000000, UsePPN: true, PPNPersen: 11,
		QuoteNumber: sp("QT-2610-0001"), TermPercent: func() *float64 { p := 50.0; return &p }(),
	}
	text, _ := renderText(t, buildInvoicePDF(inv))
	inOrder(t, text, "PT Nuhabit", "INVOICE", "Nomor : INV-2610-0007", "KEPADA", "SD Harapan", "PIC", "Ibu Sari",
		"ACARA", "Field trip (Field Trip)", "REFERENSI", "QT-2610-0001",
		"TANGGAL INVOICE", "5 Oktober 2026", "JATUH TEMPO", "20 Oktober 2026", "TERMIN", "DP 50% (50%)", "TANGGAL ACARA", "—",
		"KETERANGAN", "JUMLAH", "DP 50% (50% dari nilai kesepakatan) — sesuai QT-2610-0001", "Rp5.550.000",
		"DPP", "Rp5.000.000", "PPN 11%", "Rp550.000", "TOTAL TAGIHAN", "Rp5.550.000",
		"Sudah dibayar", "Rp6.000.000", "SISA TAGIHAN", "Rp0", "Hormat kami,", "Rina")
	if strings.Contains(text, "CATATAN") {
		t.Fatal("no note, no notes block")
	}

	inv.UsePPN, inv.Paid, inv.TermPercent, inv.QuoteNumber, inv.OwnerName, inv.BranchName = false, 0, nil, nil, nil, nil
	text, _ = renderText(t, buildInvoicePDF(inv))
	inOrder(t, text, "REFERENSI", "—", "TERMIN", "Nominal bebas", "DP 50% Rp5.550.000", "TOTAL TAGIHAN", "Tim Sales")
	for _, absent := range []string{"DPP", "Sudah dibayar", "kesepakatan", "sesuai"} {
		if strings.Contains(text, absent) {
			t.Fatalf("%q printed: %s", absent, text)
		}
	}
}

func TestPDFLetterhead(t *testing.T) {
	var logo bytes.Buffer
	img := image.NewRGBA(image.Rect(0, 0, 4, 2))
	img.Set(0, 0, color.RGBA{0, 40, 26, 255})
	if err := png.Encode(&logo, img); err != nil {
		t.Fatal(err)
	}
	head := docHead{Number: "QT-2610-0002", OrgName: "PT Maju", PicName: "Budi", DealTitle: "Outing", EventLabel: "Outing",
		CreatedAt: "5 Oktober 2026", EventDate: "—", CompanyName: sp("Venue Co"), BranchName: sp("Cabang Dago"),
		Kop: Letterhead{LegalName: "PT NüHabit Indonesia", Address: "Jl. Merdeka 1", City: "Bandung", Email: "halo@nuhabit.id",
			Phone: "022-123", NPWP: "01.234.567.8-901.000"},
		Logo: logo.Bytes()}
	doc := buildQuotationPDF(quotationDoc{docHead: head, ValidUntil: "—"})
	data, err := doc.Bytes()
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(data, []byte("/Subtype /Image")) {
		t.Fatal("logo not embedded")
	}
	text, err := extract.PDFText(data)
	if err != nil {
		t.Fatal(err)
	}
	// The profile's legal name wins over the venue company.
	inOrder(t, text, "PT NüHabit Indonesia", "Cabang Dago", "Jl. Merdeka 1, Bandung", "halo@nuhabit.id",
		"Telp. 022-123", "NPWP: 01.234.567.8-901.000", "QUOTATION", "Nomor : QT-2610-0002", "KEPADA", "PT Maju")
	if strings.Contains(text, "Venue Co") {
		t.Fatal("company name printed beside the legal name")
	}

	// An unreadable logo is skipped and the rest still prints.
	head.Logo = []byte("not an image")
	text, _ = renderText(t, buildInvoicePDF(invoiceDoc{docHead: head, Label: "DP", DueDate: "—", Amount: 1000}))
	inOrder(t, text, "PT NüHabit Indonesia", "NPWP: 01.234.567.8-901.000", "INVOICE", "Nomor : QT-2610-0002")
}

func TestDocumentHelpers(t *testing.T) {
	for _, c := range [][4]string{
		{"QT-2610-0001", "PT. Maju & Jaya  (Bdg)", "quotation", "QT-2610-0001-PT-Maju-Jaya-Bdg.pdf"},
		{"INV-1", " ünïcode ", "invoice", "INV-1-ncode.pdf"},
		{"INV-1", "&&&", "invoice", "INV-1-invoice.pdf"},
	} {
		if got := domain.DocumentFileName(c[0], c[1], c[2]); got != c[3] {
			t.Fatalf("file name %q, want %q", got, c[3])
		}
	}
	jakarta := time.FixedZone("WIB", 7*3600)
	prev := time.Local
	time.Local = jakarta
	defer func() { time.Local = prev }()
	if got := domain.DocDate(time.Date(2026, 10, 31, 18, 0, 0, 0, time.UTC)); got != "1 November 2026" {
		t.Fatalf("timestamps print in the process zone: %s", got)
	}
}
