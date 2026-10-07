package domain

// Landed cost: freight, duty, handling and other additional purchase costs
// recorded against a PO or GRN (purchasing.cogs_additional_costs) are
// allocated to that document's received lines by value. A raw material's
// landed cost rate is what was allocated to it over everything received of
// it, and the COGS estimate adds unit cost × rate to each BOM line.

// ReceiptLine is one received GRN line of a raw material, valued at quantity
// received × PO unit price.
type ReceiptLine struct {
	GrnID, PoID, MaterialID string
	Value                   float64
}

// LandedCost is an active additional cost in rupiah on a document
// (RefType "PO" or "GRN").
type LandedCost struct {
	RefType, RefID string
	Amount         float64
}

// DocKey is the key of a document's received value: "PO:<id>" or "GRN:<id>".
func DocKey(refType, refID string) string { return refType + ":" + refID }

// LandedCostRates returns, per raw material, the additional cost allocated
// to it divided by its total received value. docTotals is each document's
// received value over all its lines (other item types included), so they
// take their share of the cost too. Costs on documents with nothing received
// allocate nothing.
func LandedCostRates(costs []LandedCost, lines []ReceiptLine, docTotals map[string]float64) map[string]float64 {
	purchased := map[string]float64{}
	byDoc := map[string]map[string]float64{}
	add := func(doc, material string, v float64) {
		if byDoc[doc] == nil {
			byDoc[doc] = map[string]float64{}
		}
		byDoc[doc][material] += v
	}
	for _, l := range lines {
		purchased[l.MaterialID] += l.Value
		add(DocKey("GRN", l.GrnID), l.MaterialID, l.Value)
		add(DocKey("PO", l.PoID), l.MaterialID, l.Value)
	}
	allocated := map[string]float64{}
	for _, c := range costs {
		key := DocKey(c.RefType, c.RefID)
		total := docTotals[key]
		if total <= 0 {
			continue
		}
		for material, v := range byDoc[key] {
			allocated[material] += c.Amount * v / total
		}
	}
	rates := map[string]float64{}
	for material, a := range allocated {
		if p := purchased[material]; p > 0 && a > 0 {
			rates[material] = a / p
		}
	}
	return rates
}

// LandedCostIDR is the rupiah amount of a cost in another currency.
func LandedCostIDR(amount, exchangeRate float64) float64 {
	return round2(float64(amount * exchangeRate))
}
