package hris

import (
	"bytes"
	"compress/zlib"
	"io"
	"regexp"
	"strings"
	"testing"

	"nuhabit/backend/internal/platform/extract"
)

// Paragraphs and numbered clauses are justified like pdfkit's
// align: "justify" (word spacing on wrapped lines); the text keeps its order.
func TestContractPDFJustifiesParagraphs(t *testing.T) {
	s := func(v string) *string { return &v }
	co := map[string]*string{"company_city": s("Bandung"), "company_signer_name": s("Ilham"), "company_legal_name": s("PT NüHabit")}
	c := obj("contract_type", "pkwt", "contract_number", "K-1", "start_date", "2026-08-01", "end_date", "2027-08-01",
		"signed_at", "2026-07-20", "position_title", "Kasir", "work_location", "Outlet Sulu Bandung", "base_salary", "4500000",
		"full_name", "Budi Santoso")
	data, err := buildContractPDF(co, c)
	if err != nil {
		t.Fatal(err)
	}
	var content strings.Builder
	for _, m := range regexp.MustCompile(`(?s)stream\r?\n(.*?)endstream`).FindAllSubmatch(data, -1) {
		if r, err := zlib.NewReader(bytes.NewReader(m[1])); err == nil {
			b, _ := io.ReadAll(r)
			content.Write(b)
		}
	}
	if !regexp.MustCompile(`[1-9][0-9.]* Tw`).MatchString(content.String()) {
		t.Fatal("no justified line in the contract")
	}
	text, err := extract.PDFText(data)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{
		"telah dibuat dan ditandatangani perjanjian kerja oleh dan antara:",
		"2. Tempat kerja PIHAK KEDUA adalah Outlet Sulu Bandung, dengan kemungkinan penugasan di lokasi lain sesuai kebutuhan operasional yang wajar.",
	} {
		if !strings.Contains(text, want) {
			t.Fatalf("contract text misses %q: %s", want, text)
		}
	}
}
