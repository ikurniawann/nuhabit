package catalog

import (
	"context"

	"nuhabit/backend/internal/modules/inventory/domain"
	"nuhabit/backend/internal/modules/inventory/kit"
)

// The costed BOM of GET /api/purchasing/products/{id} (lib/purchasing/bom-cost.ts).
// The BOM line routes are in the production module.

var productBomSelect = `SELECT *, ` +
	kit.EmbedSQL("raw_material", `"item"."raw_materials"`, "id", "bom_items", "raw_material_id") + `, ` +
	kit.EmbedSQL("satuan", `"item"."units"`, "id", "bom_items", "satuan_id") +
	` FROM "manufacturing"."bom_items"`

// stockCosts is buildStockCostMap over v_raw_materials_stock for the rows'
// material ids, per satuan besar.
func (h *handler) stockCosts(ctx context.Context, rows kit.Rows, idKey string) (map[string]float64, error) {
	var ids []string
	seen := map[string]bool{}
	for _, r := range rows {
		if id := r.Str(idKey); id != "" && !seen[id] {
			seen[id] = true
			ids = append(ids, id)
		}
	}
	out := map[string]float64{}
	if len(ids) == 0 {
		return out, nil
	}
	stock, err := kit.Query(ctx, h.env.DB, `SELECT id, avg_cost FROM v_raw_materials_stock WHERE id = ANY($1::uuid[])`, ids)
	if err != nil {
		return nil, err
	}
	for _, s := range stock {
		out[s.Str("id")] = s.Num("avg_cost")
	}
	return out, nil
}

// fallbackCost is fallbackMaterialCost: avg_cost → harga_avg →
// harga_terakhir of the embedded material (raw_materials has none, so 0).
func fallbackCost(m *kit.Row) float64 {
	if m == nil {
		return 0
	}
	var v any
	for _, k := range []string{"avg_cost", "harga_avg", "harga_terakhir"} {
		if m.Get(k) != nil {
			v = m.Get(k)
			break
		}
	}
	return kit.ToNum(v)
}

// costLines is costBomLines: cost_per_unit and total_cost appended per line.
func costLines(rows kit.Rows, costOf func(*kit.Row) float64) (kit.Rows, float64) {
	total := 0.0
	for _, row := range rows {
		c := costOf(row)
		t := c * domain.QtyWithWaste(kit.ToNum(row.Get("qty_required")), kit.ToNum(row.Get("waste_factor")))
		total += t
		row.Set("cost_per_unit", c).Set("total_cost", t)
	}
	return rows, total
}
