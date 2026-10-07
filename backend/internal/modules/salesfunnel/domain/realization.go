package domain

import (
	"sort"

	"nuhabit/backend/internal/platform/jsmath"
)

// MaterialRequirement is the quantity of a raw material a quotation needs.
type MaterialRequirement struct {
	RawMaterialID string
	Needed        float64
}

// StockRow is one locked inventory row of the venue.
type StockRow struct {
	ID            string
	RawMaterialID string
	WarehouseID   *string
	QtyAvailable  float64
}

// Shortfall is a material whose venue stock is below the need.
type Shortfall struct {
	RawMaterialID string  `json:"raw_material_id"`
	Needed        float64 `json:"needed"`
	Available     float64 `json:"available"`
}

// StockDeduction is one planned movement.
type StockDeduction struct {
	InventoryID   string  `json:"inventory_id"`
	RawMaterialID string  `json:"raw_material_id"`
	WarehouseID   *string `json:"warehouse_id"`
	Take          float64 `json:"take"`
	Before        float64 `json:"before"`
	After         float64 `json:"after"`
}

// FindShortfalls is findShortfalls: stock summed over every warehouse,
// compared at 3 decimals, reported at 2.
func FindShortfalls(reqs []MaterialRequirement, stock []StockRow) []Shortfall {
	available := map[string]float64{}
	for _, row := range stock {
		available[row.RawMaterialID] += row.QtyAvailable
	}
	out := []Shortfall{}
	for _, req := range reqs {
		needed := jsmath.RoundTo(req.Needed, 3)
		have := jsmath.RoundTo(available[req.RawMaterialID], 3)
		if have < needed {
			out = append(out, Shortfall{RawMaterialID: req.RawMaterialID, Needed: jsmath.RoundTo(needed, 2), Available: jsmath.RoundTo(have, 2)})
		}
	}
	return out
}

// PlanDeductions is planDeductions: the largest warehouse row first until
// the need is met.
func PlanDeductions(reqs []MaterialRequirement, stock []StockRow) []StockDeduction {
	out := []StockDeduction{}
	for _, req := range reqs {
		remaining := jsmath.RoundTo(req.Needed, 3)
		var rows []StockRow
		for _, row := range stock {
			if row.RawMaterialID == req.RawMaterialID {
				rows = append(rows, row)
			}
		}
		sort.SliceStable(rows, func(i, j int) bool { return rows[i].QtyAvailable > rows[j].QtyAvailable })
		for _, row := range rows {
			if remaining <= 0 {
				break
			}
			take := min(row.QtyAvailable, remaining)
			if take <= 0 {
				continue
			}
			out = append(out, StockDeduction{
				InventoryID: row.ID, RawMaterialID: req.RawMaterialID, WarehouseID: row.WarehouseID,
				Take: take, Before: row.QtyAvailable, After: jsmath.RoundTo(row.QtyAvailable-take, 4),
			})
			remaining = jsmath.RoundTo(remaining-take, 4)
		}
	}
	return out
}
