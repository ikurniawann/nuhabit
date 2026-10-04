package domain

import "math"

// Ticket bundles (bundle.ts, bundle-server.ts): a bundle product has one
// "Paket" variant; one sold unit explodes into one member per person
// (pointing at a component variant) with a prorated price share.

// BundleComponent is one composition line (per bundle unit).
type BundleComponent struct {
	ComponentVariantID string
	Qty                int
	ProductName        string
	VariantName        string
	// WeightPrice is the component's unit price for the sale's season;
	// nil falls back to an even split.
	WeightPrice *float64
}

// BundleMember is one person (one band) of one bundle unit.
type BundleMember struct {
	ComponentVariantID string   `json:"component_variant_id"`
	MemberLabel        string   `json:"member_label"`
	WeightPrice        *float64 `json:"weight_price"`
}

// ExpandBundleMembers flattens the composition in order; position N always
// means the same person for the loket, bookings and guest names.
func ExpandBundleMembers(components []BundleComponent) []BundleMember {
	out := []BundleMember{}
	for _, c := range components {
		for range c.Qty {
			out = append(out, BundleMember{
				ComponentVariantID: c.ComponentVariantID,
				MemberLabel:        c.ProductName + " — " + c.VariantName,
				WeightPrice:        c.WeightPrice,
			})
		}
	}
	return out
}

// AllocateBundlePrice is allocateBundlePrice: cumulative 2dp rounding, so
// the shares always sum to the bundle price and none is negative. Missing
// or all-zero weights split evenly.
func AllocateBundlePrice(bundlePrice float64, weights []*float64) []float64 {
	if len(weights) == 0 {
		return []float64{}
	}
	usable := true
	totalWeight := 0.0
	for _, w := range weights {
		if w == nil || math.IsNaN(*w) || math.IsInf(*w, 0) || *w < 0 {
			usable = false
			break
		}
		totalWeight += *w
	}
	effective := make([]float64, len(weights))
	effectiveTotal := float64(len(weights))
	if usable && totalWeight > 0 {
		for i, w := range weights {
			effective[i] = *w
		}
		effectiveTotal = totalWeight
	} else {
		for i := range effective {
			effective[i] = 1
		}
	}
	total := Round2(bundlePrice)
	shares := make([]float64, 0, len(weights))
	cumWeight, cumAllocated := 0.0, 0.0
	for _, w := range effective {
		cumWeight += w
		cumTarget := Round2((total * cumWeight) / effectiveTotal)
		shares = append(shares, Round2(cumTarget-cumAllocated))
		cumAllocated = cumTarget
	}
	return shares
}

// CompositionRow is one loadBundleComposition row.
type CompositionRow struct {
	ComponentVariantID string
	Qty                int
	ProductName        string
	VariantName        string
	ComponentProductID string
	ComponentStatus    string
	ComponentKind      string
	VariantIsActive    bool
	PriceRegular       *float64
	PriceHigh          *float64
}

// BundleCompositionIssue is bundleCompositionIssue: "" when sellable.
func BundleCompositionIssue(rows []CompositionRow) string {
	if len(rows) == 0 {
		return "Komposisi paket masih kosong"
	}
	for _, r := range rows {
		switch {
		case r.ComponentKind != "single":
			return `Komponen "` + r.ProductName + `" bukan tiket satuan`
		case r.ComponentStatus != "active":
			return `Komponen "` + r.ProductName + `" tidak berstatus Active`
		case !r.VariantIsActive:
			return `Varian komponen "` + r.ProductName + " — " + r.VariantName + `" nonaktif`
		}
	}
	return ""
}

// ToBundleComponents weighs each component by its unit price in season.
func ToBundleComponents(rows []CompositionRow, season string) []BundleComponent {
	out := make([]BundleComponent, len(rows))
	for i, r := range rows {
		weight := r.PriceRegular
		if season == SeasonHigh {
			weight = r.PriceHigh
		}
		out[i] = BundleComponent{
			ComponentVariantID: r.ComponentVariantID, Qty: r.Qty,
			ProductName: r.ProductName, VariantName: r.VariantName, WeightPrice: weight,
		}
	}
	return out
}
