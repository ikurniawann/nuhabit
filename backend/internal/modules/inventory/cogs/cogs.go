package cogs

import (
	"context"
	"math"
	"net/http"

	"nuhabit/backend/internal/modules/inventory/domain"
	"nuhabit/backend/internal/modules/inventory/kit"
	"nuhabit/backend/internal/modules/inventory/ledger"
	"nuhabit/backend/internal/platform/httpx"
	ps "nuhabit/backend/internal/platform/scope"
	"nuhabit/backend/internal/platform/validate"
)

// lib/purchasing/cogs-estimate.ts.

/* ── COGS estimates ──────────────────────────────────────────────────── */

// overheadRate is loadOverheadRate: settings.overhead_rate percent, else
// 10%. There is no settings table today, so the TS read fails and falls
// back; the read only runs when the table exists.
func (h *handler) overheadRate(ctx context.Context) float64 {
	row, err := kit.QueryOne(ctx, h.env.DB, `SELECT to_regclass('settings') IS NOT NULL AS present`)
	if err != nil || row == nil || !row.Bool("present") {
		return 0.1
	}
	v, err := kit.QueryOne(ctx, h.env.DB, `SELECT value FROM settings WHERE key = 'overhead_rate' LIMIT 1`)
	if err != nil || v == nil || !truthy(v.Get("value")) {
		return 0.1
	}
	return kit.ToNum(v.Get("value")) / 100
}

func truthy(v any) bool {
	switch x := v.(type) {
	case nil:
		return false
	case string:
		return x != ""
	case float64:
		return x != 0 && !math.IsNaN(x)
	case bool:
		return x
	}
	return true
}

type cogsLine struct {
	materialID string
	satuanID   string
	qty, waste any
	material   *kit.Row
	satuan     *kit.Row
}

// cogsTotals are the estimate's per-unit totals.
type cogsTotals struct {
	hpp, bom, additional, overhead float64
}

// estimate is estimateBomCost: material at average cost, plus each
// material's landed cost rate (additional purchase costs), plus overhead on
// both. stockUnits converts each line's recipe unit into the stock unit
// production orders count it in (stock_factor and satuan_stok on the
// breakdown).
func estimate(lines []cogsLine, stock map[string]*kit.Row, rates map[string]float64, overhead float64, convertUnits bool,
	stockUnits ledger.BaseUnitResolver) ([]*kit.Row, cogsTotals) {
	var breakdown []*kit.Row
	total, additional := 0.0, 0.0
	for _, l := range lines {
		s := stock[l.materialID]
		qty, waste := kit.ToNum(l.qty), kit.ToNum(l.waste)
		effective := qty * (1 + waste)
		avg := 0.0
		if s != nil {
			avg = s.Num("avg_cost")
		}
		unit := avg
		if convertUnits && s != nil && !(l.satuanID != "" && s.Str("satuan_besar_id") != "" && l.satuanID == s.Str("satuan_besar_id")) {
			if f := s.Num("konversi_factor"); s.Str("satuan_kecil_id") != "" && f > 0 {
				unit = avg / f
			}
		}
		sub := effective * unit
		total += sub
		rate := rates[l.materialID]
		extra := float64(sub * rate)
		additional += extra
		get := func(r *kit.Row, k string) string {
			if r == nil {
				return ""
			}
			return r.Str(k)
		}
		line := kit.Obj("bahan_id", l.materialID, "kode", get(l.material, "kode"), "nama", get(l.material, "nama"),
			"material_type", kit.FirstNonEmpty(get(l.material, "material_type"), get(s, "material_type"), "PURCHASED"))
		if convertUnits {
			var source any
			if v := kit.FirstNonEmpty(get(l.material, "source_product_id"), get(s, "source_product_id")); v != "" {
				source = v
			}
			line.Set("source_product_id", source)
		}
		var onhand, onorder float64
		if s != nil {
			onhand, onorder = s.Num("qty_onhand"), s.Num("qty_on_order")
		}
		breakdown = append(breakdown, line.Set("jumlah", qty).
			Set("satuan", kit.FirstNonEmpty(get(l.satuan, "nama"), get(s, "satuan_kecil_nama"), get(s, "satuan_besar_nama"), "-")).
			Set("qty_available", onhand).Set("qty_on_order", onorder).Set("unit_cost", unit).Set("waste_percentage", waste*100).
			Set("effective_qty", domain.Round3(effective)).Set("subtotal", domain.Round2(sub)).
			Set("landed_cost_rate", domain.Round2(rate*100)).Set("additional_cost", domain.Round2(extra)).
			Set("stock_factor", stockUnits(l.materialID, &l.satuanID)).
			Set("satuan_stok", kit.FirstNonEmpty(get(s, "satuan_kecil_nama"), get(s, "satuan_besar_nama"), "-")))
	}
	totalOverhead := (total + additional) * overhead
	return breakdown, cogsTotals{hpp: domain.Round2(total + additional + totalOverhead), bom: domain.Round2(total),
		additional: domain.Round2(additional), overhead: domain.Round2(totalOverhead)}
}

// materialIDs are the distinct materials of the BOM lines.
func materialIDs(lines []cogsLine) []string {
	var ids []string
	seen := map[string]bool{}
	for _, l := range lines {
		if l.materialID != "" && !seen[l.materialID] {
			seen[l.materialID] = true
			ids = append(ids, l.materialID)
		}
	}
	return ids
}

func (h *handler) cogsStock(ctx context.Context, lines []cogsLine, columns string) (map[string]*kit.Row, error) {
	ids := materialIDs(lines)
	out := map[string]*kit.Row{}
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := kit.Query(ctx, h.env.DB, `SELECT `+columns+` FROM v_raw_materials_stock WHERE id = ANY($1::uuid[])`, ids)
	for _, r := range rows {
		out[r.Str("id")] = r
	}
	return out, err
}

/* GET /api/purchasing/cogs/product/{produk_id} */
func (h *handler) productCogs(w http.ResponseWriter, r *http.Request) error {
	u, err := h.itemsStaff(r)
	if err != nil {
		return err
	}
	ctx := r.Context()
	scope, err := h.env.Scope(ctx, u)
	if err != nil {
		return err
	}
	id := r.PathValue("produk_id")
	if !validate.IsUUID(id) {
		return httpx.BadRequest("Invalid product ID")
	}
	product, err := kit.QueryOne(ctx, h.env.DB, `SELECT * FROM v_products_cogs WHERE id = $1 AND is_active = true`, id)
	if err != nil || product == nil || !ps.RowInScope(scope, product.StrPtr("company_id"), product.StrPtr("branch_id")) {
		return httpx.NotFound("Product not found")
	}
	bom, err := kit.Query(ctx, h.env.DB, `SELECT *, `+
		kit.EmbedColsSQL("raw_material", `"item"."raw_materials"`, "id", "bom_items", "raw_material_id", "id", "kode", "nama", "material_type", "source_product_id")+`, `+
		kit.EmbedColsSQL("satuan", `"item"."units"`, "id", "bom_items", "satuan_id", "id", "kode", "nama")+`
		FROM "manufacturing"."bom_items" WHERE "product_id" = $1 AND "is_active" = $2 ORDER BY "created_at" ASC`, id, true)
	if err != nil {
		return err
	}
	header := kit.Obj("produk_id", product.Get("id"), "kode", product.Get("kode"), "nama", product.Get("nama"),
		"satuan", product.Get("satuan_nama"), "harga_jual", product.Get("harga_jual"))
	lines := make([]cogsLine, len(bom))
	for i, b := range bom {
		lines[i] = cogsLine{b.Str("raw_material_id"), b.Str("satuan_id"), b.Get("qty_required"), b.Get("waste_factor"),
			kit.Embed(b.Get("raw_material")), kit.Embed(b.Get("satuan"))}
	}
	if len(lines) == 0 {
		return kit.Data(w, header.Set("hpp_per_unit", 0).Set("total_bom_cost", 0).Set("total_additional_cost", 0).Set("total_overhead", 0).
			Set("breakdown_bahan", []any{}).Set("stock_warnings", []any{}).Set("warning", "This product does not have a bill of materials yet"))
	}
	stock, err := h.cogsStock(ctx, lines, "id, qty_onhand, qty_on_order, avg_cost, material_type, source_product_id, konversi_factor, satuan_kecil_id, satuan_besar_id, satuan_kecil_nama, satuan_besar_nama")
	if err != nil {
		return err
	}
	landed, err := h.landedRates(ctx, lines)
	if err != nil {
		return err
	}
	stockUnits, err := ledger.NewRecipeUnitResolver(ctx, h.env.DB, materialIDs(lines))
	if err != nil {
		return err
	}
	rate := h.overheadRate(ctx)
	breakdown, t := estimate(lines, stock, landed, rate, true, stockUnits)
	harga := product.Num("harga_jual")
	var margin, marginPct *float64
	if harga > 0 {
		m := harga - t.hpp
		p := math.Floor((m/harga)*10000+0.5) / 100
		margin, marginPct = &m, &p
	}
	warnings := []*kit.Row{}
	for _, b := range breakdown {
		qty, avail := b.Num("jumlah"), b.Num("qty_available")
		if qty > 0 && avail < qty*10 {
			warnings = append(warnings, kit.Obj("nama", b.Get("nama"), "qty_available", avail, "required_per_unit", qty,
				"stock_coverage_units", math.Floor((avail/qty)*10+0.5)/10))
		}
	}
	return kit.Data(w, header.Set("hpp_per_unit", t.hpp).Set("total_bom_cost", t.bom).Set("total_additional_cost", t.additional).
		Set("overhead_rate", rate*100).Set("total_overhead", t.overhead).Set("breakdown_bahan", breakdown).Set("margin_vs_harga_jual", margin).
		Set("margin_percentage", marginPct).Set("margin_label", domain.MarginLabel(marginPct)).Set("stock_warnings", warnings))
}

/* GET /api/purchasing/cogs/raw-material/{id} */
func (h *handler) rawMaterialCogs(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.itemsStaff(r); err != nil {
		return err
	}
	ctx := r.Context()
	id := r.PathValue("id")
	if !validate.IsUUID(id) {
		return httpx.BadRequest("Invalid raw material ID")
	}
	material, err := kit.QueryOne(ctx, h.env.DB, `SELECT * FROM v_raw_materials_stock WHERE id = $1 AND deleted_at IS NULL`, id)
	if err != nil || material == nil {
		return httpx.NotFound("Raw material not found")
	}
	bom, err := kit.Query(ctx, h.env.DB, `SELECT *, `+
		kit.EmbedColsSQL("component", `"item"."raw_materials"`, "id", "raw_material_bom_items", "component_raw_material_id", "id", "kode", "nama", "material_type")+`, `+
		kit.EmbedColsSQL("satuan", `"item"."units"`, "id", "raw_material_bom_items", "satuan_id", "id", "kode", "nama")+`
		FROM "manufacturing"."raw_material_bom_items" WHERE "output_raw_material_id" = $1 AND "is_active" = $2 ORDER BY "created_at" ASC`, id, true)
	if err != nil {
		return err
	}
	header := kit.Obj("raw_material_id", material.Get("id"), "kode", material.Get("kode"), "nama", material.Get("nama"))
	lines := make([]cogsLine, len(bom))
	for i, b := range bom {
		lines[i] = cogsLine{b.Str("component_raw_material_id"), b.Str("satuan_id"), b.Get("qty_required"), b.Get("waste_factor"),
			kit.Embed(b.Get("component")), kit.Embed(b.Get("satuan"))}
	}
	if len(lines) == 0 {
		return kit.Data(w, header.Set("hpp_per_unit", 0).Set("total_bom_cost", 0).Set("total_additional_cost", 0).Set("total_overhead", 0).
			Set("breakdown_bahan", []any{}).Set("warning", "This raw material does not have a bill of materials yet"))
	}
	stock, err := h.cogsStock(ctx, lines, "id, qty_onhand, qty_on_order, avg_cost, material_type, satuan_kecil_nama, satuan_besar_nama")
	if err != nil {
		return err
	}
	landed, err := h.landedRates(ctx, lines)
	if err != nil {
		return err
	}
	stockUnits, err := ledger.NewRecipeUnitResolver(ctx, h.env.DB, materialIDs(lines))
	if err != nil {
		return err
	}
	rate := h.overheadRate(ctx)
	breakdown, t := estimate(lines, stock, landed, rate, false, stockUnits)
	return kit.Data(w, header.Set("hpp_per_unit", t.hpp).Set("total_bom_cost", t.bom).Set("total_additional_cost", t.additional).
		Set("overhead_rate", rate*100).Set("total_overhead", t.overhead).Set("breakdown_bahan", breakdown))
}
