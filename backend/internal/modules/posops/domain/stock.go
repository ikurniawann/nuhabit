package domain

import (
	"math"
	"sort"
)

// Stock alert rules (app/api/pos/stock-alerts): low raw materials, the
// products their BOM puts at risk, and POS products under minimum stock.

// RawMaterialStock is a v_raw_materials_stock row.
type RawMaterialStock struct {
	ID                   string
	Kode, Nama, Kategori *string
	QtyOnhand, MinStock  *string
	Satuan, StatusStok   *string
}

// BomLine is an active BOM row with its product and material.
type BomLine struct {
	ProductID, RawMaterialID string
	QtyRequired, WasteFactor *string
	ProductFound             bool
	ProductKode, ProductNama *string
	ProductActive            *bool
	MaterialNama             *string
}

// StockLevel is "critical" when nothing is left (or HABIS), else "warning".
func StockLevel(qty float64, status *string) string {
	if qty <= 0 || (status != nil && *status == "HABIS") {
		return "critical"
	}
	return "warning"
}

// RawMaterialAlert is one low raw material.
type RawMaterialAlert struct {
	ID         string  `json:"id"`
	Kode       string  `json:"kode"`
	Nama       string  `json:"nama"`
	Kategori   string  `json:"kategori"`
	QtyOnhand  float64 `json:"qty_onhand"`
	MinStock   float64 `json:"min_stock"`
	Satuan     string  `json:"satuan"`
	StatusStok string  `json:"status_stok"`
	AlertLevel string  `json:"alert_level"`
}

// NewRawMaterialAlert shapes a low raw material.
func NewRawMaterialAlert(m RawMaterialStock) RawMaterialAlert {
	qty := numOf(m.QtyOnhand)
	return RawMaterialAlert{
		ID: m.ID, Kode: orStr(m.Kode, ""), Nama: orStr(m.Nama, ""), Kategori: orStr(m.Kategori, "Uncategorized"),
		QtyOnhand: qty, MinStock: numOf(m.MinStock), Satuan: orStr(m.Satuan, "unit"),
		StatusStok: orStr(m.StatusStok, "MENIPIS"), AlertLevel: StockLevel(qty, m.StatusStok),
	}
}

// IngredientAlert is one low ingredient of a product.
type IngredientAlert struct {
	MaterialID         string  `json:"material_id"`
	MaterialName       string  `json:"material_name"`
	QtyAvailable       float64 `json:"qty_available"`
	RequiredPerUnit    float64 `json:"required_per_unit"`
	StockCoverageUnits float64 `json:"stock_coverage_units"`
	AlertLevel         string  `json:"alert_level"`
}

// ProductAtRisk is a product whose ingredients run low.
type ProductAtRisk struct {
	ProductID          string            `json:"product_id"`
	Kode               string            `json:"kode"`
	Nama               string            `json:"nama"`
	MaxServings        float64           `json:"max_servings"`
	LimitingIngredient string            `json:"limiting_ingredient"`
	Ingredients        []IngredientAlert `json:"ingredients"`
	AlertLevel         string            `json:"alert_level"`
}

// ProductsAtRisk mirrors buildProductsAtRisk: an active product is at risk
// when an ingredient is MENIPIS/HABIS or covers fewer than 10 servings.
func ProductsAtRisk(bom []BomLine, stock map[string]RawMaterialStock) []ProductAtRisk {
	type entry struct {
		kode, nama  string
		ingredients []IngredientAlert
	}
	var order []string
	byProduct := map[string]*entry{}
	for _, b := range bom {
		if !b.ProductFound || b.ProductActive == nil || !*b.ProductActive {
			continue
		}
		required := numOf(b.QtyRequired)
		if required <= 0 {
			continue
		}
		st, found := stock[b.RawMaterialID]
		available := numOf(st.QtyOnhand)
		effective := required * (1 + numOf(b.WasteFactor))
		coverage := 0.0
		if effective > 0 {
			coverage = available / effective
		}
		status := ""
		if found && st.StatusStok != nil {
			status = *st.StatusStok
		}
		if status != "HABIS" && status != "MENIPIS" && !(available < effective*10) {
			continue
		}
		e, ok := byProduct[b.ProductID]
		if !ok {
			e = &entry{kode: orStr(b.ProductKode, ""), nama: orStr(b.ProductNama, "")}
			byProduct[b.ProductID] = e
			order = append(order, b.ProductID)
		}
		name := orStr(b.MaterialNama, orStr(st.Nama, "Bahan"))
		var statusPtr *string
		if found {
			statusPtr = st.StatusStok
		}
		e.ingredients = append(e.ingredients, IngredientAlert{
			MaterialID: b.RawMaterialID, MaterialName: name, QtyAvailable: round2(available),
			RequiredPerUnit: round2(required), StockCoverageUnits: round2(coverage),
			AlertLevel: StockLevel(available, statusPtr),
		})
	}
	out := []ProductAtRisk{}
	for _, id := range order {
		e := byProduct[id]
		sorted := append([]IngredientAlert(nil), e.ingredients...)
		sort.SliceStable(sorted, func(i, j int) bool { return sorted[i].StockCoverageUnits < sorted[j].StockCoverageUnits })
		limiting := sorted[0]
		level := "warning"
		for _, ing := range sorted {
			if ing.AlertLevel == "critical" {
				level = "critical"
			}
		}
		servings := math.Floor(limiting.StockCoverageUnits)
		if servings < 0 {
			servings = 0
		}
		out = append(out, ProductAtRisk{ProductID: id, Kode: e.kode, Nama: e.nama, MaxServings: servings,
			LimitingIngredient: limiting.MaterialName, Ingredients: sorted, AlertLevel: level})
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].MaxServings < out[j].MaxServings })
	return out
}

// PosStockRow is a tracked POS product's stock.
type PosStockRow struct {
	ID                 string
	Sku, Name          *string
	Quantity, MinStock *string
}

// PosStockAlert is a tracked POS product at or under its minimum.
type PosStockAlert struct {
	ID         string  `json:"id"`
	Sku        string  `json:"sku"`
	Name       string  `json:"name"`
	Current    float64 `json:"current"`
	Min        float64 `json:"min"`
	AlertLevel string  `json:"alert_level"`
}

// PosStockAlerts keeps products with a minimum whose stock is at or under
// it, lowest stock first.
func PosStockAlerts(rows []PosStockRow) []PosStockAlert {
	out := []PosStockAlert{}
	for _, r := range rows {
		current, minimum := numOf(r.Quantity), numOf(r.MinStock)
		if minimum <= 0 || current > minimum {
			continue
		}
		level := "warning"
		if current <= 0 {
			level = "critical"
		}
		out = append(out, PosStockAlert{ID: r.ID, Sku: orStr(r.Sku, ""), Name: orStr(r.Name, ""), Current: current, Min: minimum, AlertLevel: level})
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Current < out[j].Current })
	return out
}
