package domain

import "testing"

// Cases ported from frontend/src/lib/inventory/*.test.ts and
// frontend/src/lib/purchasing/{packs,raw-material-coa,production-*}.test.ts.

func p(v float64) *float64 { return &v }
func s(v string) *string   { return &v }

func TestReorder(t *testing.T) {
	cases := []struct {
		l    StockLevel
		want float64
	}{
		{StockLevel{3, 2, 10, p(50)}, 45},
		{StockLevel{40, 20, 10, p(50)}, 0},
		{StockLevel{2, 0, 10, p(5)}, 8},
		{StockLevel{2, 0, 10, nil}, 8},
		{StockLevel{0.1, 0.2, 0, p(1)}, 0.7},
	}
	for _, c := range cases {
		if got := ReorderQuantity(c.l); got != c.want {
			t.Errorf("%+v: %v, want %v", c.l, got, c.want)
		}
	}
	if got := SuggestReorder(StockLevel{4, 6, 10, p(100)}); got != (ReorderSuggestion{6, 90, "maximum"}) {
		t.Errorf("maximum: %+v", got)
	}
	if got := SuggestReorder(StockLevel{4, 0, 10, nil}); got != (ReorderSuggestion{6, 9, "minimum_buffer"}) {
		t.Errorf("buffer: %+v", got)
	}
	if got := SuggestReorder(StockLevel{10, 0, 10, p(0)}).SuggestedQty; got != 10 {
		t.Errorf("no shortage: %v", got)
	}
}

func TestOpnameRules(t *testing.T) {
	if err := AssertOpnameEditable("completed"); err == nil || err.Error() != "Stock opname yang sudah selesai tidak dapat diubah" {
		t.Error(err)
	}
	if err := AssertOpnameEditable("in_progress"); err != nil {
		t.Error(err)
	}
	if err := AssertOpnameCompletable("draft", []bool{true, false, false}); err == nil || err.Error() != "Masih ada 2 baris yang belum dihitung" {
		t.Error(err)
	}
	if err := AssertOpnameCompletable("cancelled", nil); err == nil || err.Error() != "Stock opname yang dibatalkan tidak dapat diselesaikan" {
		t.Error(err)
	}
	counted, variance, next := SummarizeOpnameCounts("draft", []OpnameLineCount{{p(8), p(-2)}, {p(5), p(0)}, {nil, nil}})
	if counted != 2 || variance != 1 || next != "in_progress" {
		t.Errorf("summary %d %d %s", counted, variance, next)
	}
	if _, _, next := SummarizeOpnameCounts("draft", []OpnameLineCount{{nil, nil}}); next != "draft" {
		t.Error(next)
	}
}

func TestExpiryAndScrap(t *testing.T) {
	today := "2026-10-03"
	for date, want := range map[string]string{"2026-11-01": "fresh", "2026-10-10": "near", "2026-10-02": "expired"} {
		if got := ExpiryState(s(date), today, 7); got != want {
			t.Errorf("%s: %s, want %s", date, got, want)
		}
	}
	if ExpiryState(nil, today, 7) != "none" || DaysBetween("2026-10-03", "2026-10-01") != -2 {
		t.Error("none / days")
	}
	sum := SummarizeExpiry([]ExpiryBatch{{s("2026-10-05"), 2, 100}, {s("2026-10-01"), 1.5, 10}, {nil, 9, 1}}, today, 7)
	if sum != (ExpirySummary{1, 2, 200, 1, 1.5, 15}) {
		t.Errorf("summary %+v", sum)
	}
	if EvaluateScrap(10, 10, nil) != "" || EvaluateScrap(0.1+0.2, 0.3, nil) != "" {
		t.Error("scrap allowed")
	}
	if got := EvaluateScrap(11, 10, nil); got != "Stok gudang tidak cukup (tersedia 10)" {
		t.Error(got)
	}
	if got := EvaluateScrap(3, 10, p(2)); got != "Qty melebihi sisa batch (2)" {
		t.Error(got)
	}
	if got := EvaluateScrap(0, 10, nil); got != "Qty scrap harus lebih dari 0" {
		t.Error(got)
	}
}

func TestPacksAndUnits(t *testing.T) {
	if PackToBase(10, 24) != 240 || PackToBase(2, 0) != 2 || PackPriceToBase(396000, 24) != 16500 || PackPriceToBase(1000, 0) != 1000 {
		t.Error("pack conversions")
	}
	m := &Material{SatuanBesarID: s("ctn"), SatuanKecilID: s("pcs"), KonversiFactor: p(24)}
	if f := PackFactor(m, nil, "ctn"); f != 24 {
		t.Errorf("legacy big unit %v", f)
	}
	if f := PackFactor(m, []Pack{{SatuanID: "box", QtyInBaseUnit: 12}}, "box"); f != 12 {
		t.Errorf("pack row %v", f)
	}
	if f := PackFactor(m, nil, "unknown"); f != 24 {
		t.Errorf("unknown unit falls back to the purchase pack: %v", f)
	}
	if f := PackFactor(nil, nil, "x"); f != 1 {
		t.Error(f)
	}
	if h := MasterHargaBeliFromBaseUnitCost(500, m); h != 12000 {
		t.Error(h)
	}
	planned := PlanUnitConversions(s("ctn"), s("pcs"), "24.0000", []PlannedConversion{{SatuanID: "ctn", QtyInBaseUnit: 10.0, IsPurchaseDefault: func() *bool { b := true; return &b }()}})
	if len(planned) != 2 || planned[1].QtyInBaseUnit != "24.0000" || planned[1].IsPurchaseDefault == nil {
		t.Errorf("legacy units win over the pack, its flags stay: %+v", planned)
	}
	if _, err := PackDefaultFlagsToReset([]PlannedConversion{{IsIssueDefault: func() *bool { b := true; return &b }()}, {IsIssueDefault: func() *bool { b := true; return &b }()}}); err == nil {
		t.Error("two issue defaults must be refused")
	}
}

func TestCoaDefaults(t *testing.T) {
	cases := []struct{ kategori, asset, production string }{
		{"KERING", "1301001", "5101001"},
		{"DAIRY", "1301002", "5101001"},
		{"SAYUR", "1301008", "5101003"},
		{"BAKAR", "6201005", "6201005"},
		{"ST Dry Goods", "1301001", "5101001"},
		{"Fruit & Vegetable", "1301008", "5101003"},
		{"ST RTD", "1301005", "5201001"},
		{"Bahan WIP", "1301006", "5101001"},
		{"Lain-lain", "", ""},
	}
	for _, c := range cases {
		if a, pr := DefaultCoa(c.kategori); a != c.asset || pr != c.production {
			t.Errorf("%s: %s %s", c.kategori, a, pr)
		}
	}
	if LegacyCoaEnum("", "6201001", "") != "RND" || LegacyCoaEnum("", "", "") != "" {
		t.Error("legacy enum")
	}
	if NormalizeCoaAccountCode("1 3 01-001") != "1301001" || NormalizeCoaAccountCode("12") != "" {
		t.Error("normalize")
	}
}

func TestProductionRules(t *testing.T) {
	if NextProductionNumber("PROD-202610", "PROD-202610-0009") != "PROD-202610-0010" || NextProductionNumber("PROD-202610", "") != "PROD-202610-0001" {
		t.Error("numbers")
	}
	if WipCode("prd-2026/1004 001") != "WPPRD20261004001" || WipCode("") != "WPWIP" {
		t.Error(WipCode("prd-2026/1004 001"))
	}
	if _, msg := ValidateVariantSplit(3, []VariantRow{{"a", 1}, {"a", 2}}, []string{"a"}); msg != "Varian ganda" {
		t.Error(msg)
	}
	if _, msg := ValidateVariantSplit(3, []VariantRow{{"a", 1.255}}, []string{"a"}); msg != "Rincian varian harus berjumlah sama dengan jumlah aktual (1.25 vs 3)" {
		t.Error(msg)
	}
	if rows, msg := ValidateVariantSplit(2, []VariantRow{{"a", 1.005}, {"b", 0.995}}, []string{"a", "b"}); msg != "" || len(rows) != 2 {
		t.Error(msg)
	}
	if got := CompletionMessage("PROD-1", 2840.4, p(40.5)); got != "Produksi PROD-1 selesai. HPP aktual Rp2.840 tersinkron ke POS. Margin POS 40.5%." {
		t.Error(got)
	}
	r := BuildHppReview(10000, 10400.6, 2)
	if r.HppResep != 10401 || r.HppSelisih != 401 || !r.PerluReview {
		t.Errorf("hpp review %+v", r)
	}
	if ResolvePosStation("", "Dessert") != "bar" || ResolvePosStation("BAR", "") != "bar" || ResolvePosStation("", "Roti") != "bakery" {
		t.Error("station") // "dessert" contains "es": the TS regex picks bar first
	}
	if FormatRupiah(-1234567.5) != "-Rp1.234.567" {
		t.Error(FormatRupiah(-1234567.5))
	}
}
