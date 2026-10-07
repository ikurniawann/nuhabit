package domain

import "math"

// Pack is a purchase pack of a raw material (item.raw_material_unit_conversions):
// QtyInBase base units per pack. Port of lib/purchasing/packs.ts.
type Pack struct {
	SatuanID          string
	QtyInBase         float64
	IsBase            bool
	IsPurchaseDefault bool
	Inactive          bool
}

// UnitMaterial is the legacy big/small unit pair of a raw material.
type UnitMaterial struct {
	SatuanBesarID, SatuanKecilID string
	KonversiFactor               float64 // Number(konversi_factor); NULL reads as 0
}

func safeFactor(f float64) float64 {
	if !math.IsNaN(f) && !math.IsInf(f, 0) && f > 0 {
		return f
	}
	return 1
}

// LegacyPacks is legacyPacks: the small unit is the base, the big unit holds
// konversi_factor base units (1 when there is no small unit).
func LegacyPacks(m UnitMaterial) []Pack {
	big := m.SatuanBesarID
	small := ""
	if m.SatuanKecilID != "" && m.SatuanKecilID != big {
		small = m.SatuanKecilID
	}
	var packs []Pack
	if small != "" {
		packs = append(packs, Pack{SatuanID: small, QtyInBase: 1, IsBase: true})
	}
	if big != "" {
		factor := 1.0
		if small != "" {
			factor = safeFactor(m.KonversiFactor)
		}
		packs = append(packs, Pack{SatuanID: big, QtyInBase: factor, IsBase: small == "", IsPurchaseDefault: true})
	}
	return packs
}

// ResolvePacks is resolvePacks: the active packs plus legacy units they miss.
func ResolvePacks(m UnitMaterial, rows []Pack) []Pack {
	var active []Pack
	known := map[string]bool{}
	for _, p := range rows {
		if !p.Inactive {
			active = append(active, p)
			known[p.SatuanID] = true
		}
	}
	if len(active) == 0 {
		return LegacyPacks(m)
	}
	for _, p := range LegacyPacks(m) {
		if !known[p.SatuanID] {
			p.IsPurchaseDefault = false
			active = append(active, p)
		}
	}
	return active
}

// PackFactor is packFactor: base units per transaction unit. An unknown or
// empty unit falls back to the legacy big unit; no material means 1.
func PackFactor(m *UnitMaterial, rows []Pack, satuanID string) float64 {
	if m == nil {
		return 1
	}
	var usable []Pack
	for _, p := range rows {
		if p.QtyInBase > 0 {
			usable = append(usable, p)
		}
	}
	if satuanID != "" {
		for _, p := range ResolvePacks(*m, usable) {
			if p.SatuanID == satuanID && !p.Inactive {
				return p.QtyInBase
			}
		}
	}
	for _, p := range LegacyPacks(*m) {
		if p.IsPurchaseDefault {
			return p.QtyInBase
		}
	}
	return 1
}
