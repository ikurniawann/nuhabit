package catalog

import (
	"encoding/json"
	"reflect"
	"testing"
)

// Ported from frontend/src/lib/purchasing/import-spreadsheet.test.ts and
// import-rules.test.ts (raw material and product rules).

func TestCellParsers(t *testing.T) {
	if got := parseNumberCell("1,250.5", 0); got != 1250.5 {
		t.Errorf("parseNumberCell thousands = %v", got)
	}
	if got := parseNumberCell(" ", 30); got != 30 {
		t.Errorf("parseNumberCell blank = %v", got)
	}
	if got := parseNumberCell("abc", 1); got != 1 {
		t.Errorf("parseNumberCell invalid = %v", got)
	}
	if got := parseOptionalIntCell("14 hari"); got == nil || *got != 14 {
		t.Errorf("parseOptionalIntCell = %v", got)
	}
	if parseOptionalIntCell("") != nil || emptyToNull("  ") != nil || *emptyToNull(" x ") != "x" {
		t.Error("blank cells must be nil")
	}
	if !parseActiveCell("") || parseActiveCell("Nonaktif") || !parseActiveCell("active") {
		t.Error("parseActiveCell")
	}
	for in, want := range map[string]int{"BHN-2026-0007": 8, "": 1, "SUP-2026-x": 1} {
		if got := nextCodeSequence(in); got != want {
			t.Errorf("nextCodeSequence(%q) = %d, want %d", in, got, want)
		}
	}
}

func TestImportSummaryShape(t *testing.T) {
	sum := newImportSummary()
	sum.Imported += 2
	sum.skip(3, "gagal")
	b, _ := json.Marshal(sum)
	if string(b) != `{"success":true,"imported":2,"updated":0,"skipped":1,"errors":[{"row":3,"message":"gagal"}]}` {
		t.Fatalf("summary = %s", b)
	}
	if b, _ := json.Marshal(newImportSummary()); string(b) != `{"success":true,"imported":0,"updated":0,"skipped":0,"errors":[]}` {
		t.Fatalf("empty summary = %s", b)
	}
}

func TestRawMaterialRules(t *testing.T) {
	f := readRawMaterialRow(map[string]string{
		"nama": " Gula ", "kategori": "bumbu", "satuan_besar_kode": "SACK", "konversi_factor": "50",
		"harga_beli": "500,000", "coa": "rnd", "opening_stock": "0", "status": "inactive",
	})
	if f.nama != "Gula" || f.coa == nil || *f.coa != "RND" || f.konversiFactor != 50 || f.hargaBeli != 500000 ||
		!f.hasStockValue || f.stockQty != 0 || f.isActive || f.stokMinimum != 0 || f.shelfLifeDays != nil {
		t.Fatalf("readRawMaterialRow = %+v", f)
	}
	if readRawMaterialRow(map[string]string{"coa": "OPEX"}).coa != nil {
		t.Error("an unknown COA must be nil")
	}
	if readRawMaterialRow(map[string]string{"opening_stock": " "}).hasStockValue {
		t.Error("a blank stock cell is no stock value")
	}
	if got := readRawMaterialRow(map[string]string{"nama": "x"}).missing(); !reflect.DeepEqual(got, []string{"satuan_besar_kode", "kategori"}) {
		t.Errorf("missing = %v", got)
	}
	if got := normalizeKategori(" bahan kering "); got != "BAHAN_KERING" {
		t.Errorf("normalizeKategori = %q", got)
	}
	if unitCostForStock(500000, 50, true) != 10000 || unitCostForStock(500000, 50, false) != 500000 || unitCostForStock(500000, 0, true) != 500000 {
		t.Error("unitCostForStock")
	}

	kg, pcs := "kg", "pcs"
	fifty, one := 50.0, 1.0
	cases := []struct {
		big      string
		small    *string
		konversi *float64
		want     []unitConversion
	}{
		{"sack", &kg, &fifty, []unitConversion{{"kg", 1, true}, {"sack", 50, false}}},
		{"kg", &kg, &one, []unitConversion{{"kg", 1, true}}},
		{"pcs", nil, &fifty, []unitConversion{{"pcs", 1, true}}},
		{"box", &pcs, nil, []unitConversion{{"pcs", 1, true}, {"box", 1, false}}},
	}
	for _, c := range cases {
		if got := buildUnitConversions(c.big, c.small, c.konversi); !reflect.DeepEqual(got, c.want) {
			t.Errorf("buildUnitConversions(%s) = %+v, want %+v", c.big, got, c.want)
		}
	}
}

func TestProductRules(t *testing.T) {
	for in, want := range map[string]string{"work in progress": "WIP", "": "FINISHED_GOOD", "other": "FINISHED_GOOD", "wip": "WIP"} {
		if got := normalizeOutputType(in); got != want {
			t.Errorf("normalizeOutputType(%q) = %q", in, got)
		}
	}
	b, _ := json.Marshal(productPayload(map[string]string{"nama": " Kaos ", "kategori": "merch", "status": "no"}, "unit-1"))
	want := `{"nama":"Kaos","kategori":"MERCH","satuan_id":"unit-1","deskripsi":null,"harga_jual":0,"harga_modal":0,` +
		`"markup_persen":30,"production_output_type":"FINISHED_GOOD","is_active":false}`
	if string(b) != want {
		t.Fatalf("productPayload = %s", b)
	}
}
