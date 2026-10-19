package legacy

import "testing"

func TestOrderRules(t *testing.T) {
	if _, msg := validateVariantSplit(3, []variantRow{{"a", 1}, {"a", 2}}, []string{"a"}); msg != "Varian ganda" {
		t.Error(msg)
	}
	if _, msg := validateVariantSplit(3, []variantRow{{"a", 1.255}}, []string{"a"}); msg != "Rincian varian harus berjumlah sama dengan jumlah aktual (1.25 vs 3)" {
		t.Error(msg)
	}
	if rows, msg := validateVariantSplit(2, []variantRow{{"a", 1.005}, {"b", 0.995}}, []string{"a", "b"}); msg != "" || len(rows) != 2 {
		t.Error(msg)
	}
	margin := 40.5
	if got := completionMessage("PROD-1", 2840.4, &margin); got != "Produksi PROD-1 selesai. HPP aktual Rp2.840 tersinkron ke POS. Margin POS 40.5%." {
		t.Error(got)
	}
	if coverageMode("IN_PROGRESS") != "actual" || coverageMode("DRAFT") != "planned" || nextProductionStep("X") != "Production order bisa dilanjutkan." {
		t.Error("coverage")
	}
}
