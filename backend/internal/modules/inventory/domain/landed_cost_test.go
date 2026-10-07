package domain

import (
	"math"
	"testing"
)

func TestLandedCostRates(t *testing.T) {
	lines := []ReceiptLine{
		// GRN g1 on PO p1: rice 1.2M and sugar 0.6M; the PO's GRN g2 brings 0.2M more rice.
		{GrnID: "g1", PoID: "p1", MaterialID: "rice", Value: 1200000},
		{GrnID: "g1", PoID: "p1", MaterialID: "sugar", Value: 600000},
		{GrnID: "g2", PoID: "p1", MaterialID: "rice", Value: 200000},
		// Rice bought before without any additional cost.
		{GrnID: "g0", PoID: "p0", MaterialID: "rice", Value: 600000},
	}
	// g1 also received a 200k non-raw-material line, so it carries 2M of value.
	totals := map[string]float64{"GRN:g1": 2000000, "GRN:g2": 200000, "PO:p1": 2200000, "GRN:g0": 600000, "PO:p0": 600000}
	costs := []LandedCost{
		{RefType: "GRN", RefID: "g1", Amount: 100000}, // 60k rice, 30k sugar, 10k the other line
		{RefType: "PO", RefID: "p1", Amount: 22000},   // 14k rice, 6k sugar, 2k other
		{RefType: "GRN", RefID: "missing", Amount: 5000},
	}
	got := LandedCostRates(costs, lines, totals)
	want := map[string]float64{"rice": 74000.0 / 2000000, "sugar": 36000.0 / 600000}
	if len(got) != len(want) {
		t.Fatalf("rates %v", got)
	}
	for m, w := range want {
		if math.Abs(got[m]-w) > 1e-12 {
			t.Fatalf("rate %s = %v, want %v", m, got[m], w)
		}
	}
	if r := LandedCostRates(nil, lines, totals); len(r) != 0 {
		t.Fatalf("no costs %v", r)
	}
	if r := LandedCostRates(costs, nil, nil); len(r) != 0 {
		t.Fatalf("no receipts %v", r)
	}
}

func TestLandedCostIDR(t *testing.T) {
	if got := LandedCostIDR(1250.5, 15873.25); got != 19849499.13 {
		t.Fatalf("idr %v", got)
	}
}
