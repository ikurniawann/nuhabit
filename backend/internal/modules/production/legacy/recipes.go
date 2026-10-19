package legacy

import (
	"context"
	"net/http"

	"nuhabit/backend/internal/modules/inventory/kit"
)

// lib/purchasing/production-recipes.ts and production-wip.ts.

// recipeItems is listScopedItems over the products or raw materials.
func (h *handler) recipeItems(r *http.Request, kind string) (kit.Rows, error) {
	u, err := h.itemsStaff(r)
	if err != nil {
		return nil, err
	}
	scope, err := h.env.Scope(r.Context(), u)
	if err != nil {
		return nil, err
	}
	return h.ports.Items.RecipeItems(r.Context(), h.env.DB, kind, scope)
}

// bomCounts is countBomLines: active BOM lines per item id.
func (h *handler) bomCounts(ctx context.Context, table, column string, rows kit.Rows) (map[string]int, error) {
	out := map[string]int{}
	if len(rows) == 0 {
		return out, nil
	}
	ids := make([]string, len(rows))
	for i, r := range rows {
		ids[i] = r.Str("id")
	}
	list, err := kit.Query(ctx, h.env.DB, `SELECT `+column+`::text AS id FROM manufacturing.`+table+
		` WHERE `+column+` = ANY($1::uuid[]) AND is_active = true`, ids)
	for _, l := range list {
		out[l.Str("id")]++
	}
	return out, err
}

/* GET /api/purchasing/production/product-recipes */
func (h *handler) productRecipes(w http.ResponseWriter, r *http.Request) error {
	rows, err := h.recipeItems(r, "product")
	if err != nil {
		return err
	}
	counts, err := h.bomCounts(r.Context(), "bom_items", "product_id", rows)
	if err != nil {
		return err
	}
	for _, p := range rows {
		est := p.Get("hpp_estimasi")
		if est == nil {
			est = p.Get("estimated_cogs")
		}
		p.Set("total_bahan_baku", counts[p.Str("id")]).Set("hpp_estimasi", kit.ToNum(est))
	}
	return kit.Data(w, rows)
}

/* GET /api/purchasing/production/raw-material-recipes */
func (h *handler) rawMaterialRecipes(w http.ResponseWriter, r *http.Request) error {
	rows, err := h.recipeItems(r, "raw_material")
	if err != nil {
		return err
	}
	counts, err := h.bomCounts(r.Context(), "raw_material_bom_items", "output_raw_material_id", rows)
	if err != nil {
		return err
	}
	for _, m := range rows {
		m.Set("total_bahan_baku", counts[m.Str("id")]).Set("hpp_estimasi", m.Num("avg_cost"))
	}
	return kit.Data(w, rows)
}

/* GET /api/purchasing/production/wip — WIP materials with stock and latest batch. */
func (h *handler) wip(w http.ResponseWriter, r *http.Request) error {
	u, err := h.itemsStaff(r)
	if err != nil {
		return err
	}
	ctx := r.Context()
	db := h.env.DB
	scope, err := h.env.Scope(ctx, u)
	if err != nil {
		return err
	}
	rows, products, err := h.ports.Items.WipMaterials(ctx, db, r, u.ID, scope)
	if err != nil {
		return err
	}
	ids := make([]string, len(rows))
	for i, row := range rows {
		ids[i] = row.Str("id")
	}
	latest := map[string]*kit.Row{}
	if len(ids) > 0 {
		batches, err := kit.Query(ctx, db, `SELECT id, product_id, wip_raw_material_id, batch_number, qty_produced, hpp_per_unit, total_cost,
			created_at, production_order_id, `+
			kit.EmbedColsSQL("production_order", `"manufacturing"."production_orders"`, "id", "production_batches", "production_order_id", "id", "nomor_produksi", "status")+`
			FROM production_batches WHERE output_type = 'WIP' AND wip_raw_material_id = ANY($1::uuid[]) ORDER BY created_at DESC`, ids)
		if err != nil {
			return err
		}
		for _, b := range batches {
			if id := b.Str("wip_raw_material_id"); id != "" && latest[id] == nil {
				latest[id] = b
			}
		}
	}
	data := make([]*kit.Row, len(rows))
	var summary struct {
		TotalWip   int     `json:"total_wip"`
		ReadyWip   int     `json:"ready_wip"`
		TotalQty   float64 `json:"total_qty"`
		TotalValue float64 `json:"total_value"`
	}
	for i, row := range rows {
		onhand, avg := row.Num("qty_onhand"), row.Num("avg_cost")
		var source, batch any
		if s := row.Str("source_product_id"); s != "" {
			if p, ok := products[s]; ok {
				source = p
			}
		}
		if b := latest[row.Str("id")]; b != nil {
			po := embedded(b.Get("production_order"))
			var poNumber, poStatus any
			if po != nil {
				if n := po.Str("nomor_produksi"); n != "" {
					poNumber = n
				}
				if st := po.Str("status"); st != "" {
					poStatus = st
				}
			}
			batch = kit.Obj("id", b.Get("id"), "batch_number", b.Get("batch_number"), "qty_produced", b.Num("qty_produced"),
				"hpp_per_unit", b.Num("hpp_per_unit"), "total_cost", b.Num("total_cost"), "created_at", b.Get("created_at"),
				"production_order_id", b.Get("production_order_id"), "production_order_number", poNumber, "production_order_status", poStatus)
		}
		data[i] = kit.Obj("id", row.Get("id"), "kode", row.Str("kode"), "nama", kit.FirstNonEmpty(row.Str("nama"), row.Str("id")),
			"kategori", kit.FirstNonEmpty(row.Str("kategori"), "-"), "satuan", row.Str("satuan_besar_nama"), "qty_onhand", onhand,
			"qty_on_order", row.Num("qty_on_order"), "avg_cost", avg, "status_stok", kit.FirstNonEmpty(row.Str("status_stok"), "HABIS"),
			"source_product_id", row.Get("source_product_id"), "source_product", source, "latest_batch", batch)
		summary.TotalWip++
		summary.TotalQty += onhand
		summary.TotalValue += onhand * avg
		if onhand > 0 {
			summary.ReadyWip++
		}
	}
	return kit.OK(w, kit.Obj("success", true, "data", data, "summary", summary))
}
