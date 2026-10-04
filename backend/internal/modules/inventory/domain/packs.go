// Package domain holds the inventory rules as pure functions: packs and base
// units, batches and expiry, reorder suggestions, opname and scrap checks,
// stock status and transfer routing. Ported from frontend/src/lib/inventory
// and frontend/src/lib/purchasing (packs, raw-material-units).
package domain

import "math"

// Pack is a named multiple of a material's base unit
// (item.raw_material_unit_conversions).
type Pack struct {
	SatuanID          string
	QtyInBaseUnit     float64
	IsBase            bool
	IsPurchaseDefault bool
	IsIssueDefault    bool
	// Inactive mirrors is_active === false (absent means active).
	Inactive bool
}

// Material is the legacy unit pair on item.raw_materials.
type Material struct {
	SatuanBesarID  *string
	SatuanKecilID  *string
	KonversiFactor *float64
}

func safeFactor(f float64) float64 {
	if math.IsNaN(f) || math.IsInf(f, 0) || f <= 0 {
		return 1
	}
	return f
}

// RoundQty is Math.round(v * 1000) / 1000.
func RoundQty(v float64) float64 { return math.Floor(v*1000+0.5) / 1000 }

// RoundMoney is Math.round(v * 100) / 100.
func RoundMoney(v float64) float64 { return math.Floor(v*100+0.5) / 100 }

// PackToBase converts a pack quantity to base units.
func PackToBase(packQty, factor float64) float64 { return RoundQty(packQty * safeFactor(factor)) }

// PackPriceToBase converts a per-pack price to a per-base-unit price.
func PackPriceToBase(packPrice, factor float64) float64 {
	if math.IsNaN(factor) || math.IsInf(factor, 0) || factor <= 0 {
		return packPrice
	}
	return RoundMoney(packPrice / factor)
}

func findPack(packs []Pack, satuanID string) *Pack {
	if satuanID == "" {
		return nil
	}
	for i := range packs {
		if packs[i].SatuanID == satuanID && !packs[i].Inactive {
			return &packs[i]
		}
	}
	return nil
}

// LegacyPacks is legacyPacks: satuan kecil is the base, satuan besar is
// konversi_factor of it.
func LegacyPacks(m Material) []Pack {
	big := ""
	if m.SatuanBesarID != nil {
		big = *m.SatuanBesarID
	}
	small := ""
	if m.SatuanKecilID != nil && *m.SatuanKecilID != "" && *m.SatuanKecilID != big {
		small = *m.SatuanKecilID
	}
	var packs []Pack
	if small != "" {
		packs = append(packs, Pack{SatuanID: small, QtyInBaseUnit: 1, IsBase: true, IsIssueDefault: true})
	}
	if big != "" {
		factor := 1.0
		if small != "" {
			k := math.NaN()
			if m.KonversiFactor != nil {
				k = *m.KonversiFactor
			}
			factor = safeFactor(k)
		}
		packs = append(packs, Pack{SatuanID: big, QtyInBaseUnit: factor, IsBase: small == "", IsPurchaseDefault: true, IsIssueDefault: small == ""})
	}
	return packs
}

// ResolvePacks is resolvePacks: active rows plus legacy units they miss.
func ResolvePacks(m Material, rows []Pack) []Pack {
	var active []Pack
	for _, p := range rows {
		if !p.Inactive {
			active = append(active, p)
		}
	}
	if len(active) == 0 {
		return LegacyPacks(m)
	}
	known := map[string]bool{}
	for _, p := range active {
		known[p.SatuanID] = true
	}
	for _, p := range LegacyPacks(m) {
		if !known[p.SatuanID] {
			p.IsPurchaseDefault, p.IsIssueDefault = false, false
			active = append(active, p)
		}
	}
	return active
}

// PackFactor is packFactor: transaction unit → base unit factor. A nil
// material is factor 1; unknown units fall back to the legacy purchase pack.
func PackFactor(m *Material, rows []Pack, satuanID string) float64 {
	if m == nil {
		return 1
	}
	var usable []Pack
	for _, p := range rows {
		if p.QtyInBaseUnit > 0 {
			usable = append(usable, p)
		}
	}
	if p := findPack(ResolvePacks(*m, usable), satuanID); p != nil {
		return p.QtyInBaseUnit
	}
	for _, p := range LegacyPacks(*m) {
		if p.IsPurchaseDefault {
			return p.QtyInBaseUnit
		}
	}
	return 1
}

// MasterHargaBeliFromBaseUnitCost scales a base-unit cost to the satuan
// besar price kept on the master (masterHargaBeliFromBaseUnitCost).
func MasterHargaBeliFromBaseUnitCost(baseUnitCost float64, m *Material) float64 {
	if baseUnitCost <= 0 || math.IsNaN(baseUnitCost) {
		return 0
	}
	big := ""
	if m != nil && m.SatuanBesarID != nil {
		big = *m.SatuanBesarID
	}
	f := PackFactor(m, nil, big)
	if f <= 0 {
		f = 1
	}
	return baseUnitCost * f
}
