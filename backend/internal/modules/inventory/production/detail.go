package production

import (
	"context"
	"encoding/json"
	"math"
	"net/http"

	"nuhabit/backend/internal/modules/inventory/domain"
	"nuhabit/backend/internal/modules/inventory/kit"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/validate"
)

// coverage is one buildStockCoverage line.
type coverage struct {
	ID            any     `json:"id"`
	RawMaterialID any     `json:"raw_material_id"`
	Kode          string  `json:"kode"`
	Nama          string  `json:"nama"`
	RequiredQty   float64 `json:"required_qty"`
	QtyOnhand     float64 `json:"qty_onhand"`
	ShortageQty   float64 `json:"shortage_qty"`
	StockStatus   string  `json:"stock_status"`
}

// stockMap is loadStockMap: v_raw_materials_stock by material id.
func (h *handler) stockMap(ctx context.Context, rows kit.Rows) (map[string]*kit.Row, error) {
	var ids []string
	seen := map[string]bool{}
	for _, r := range rows {
		if id := r.Str("raw_material_id"); id != "" && !seen[id] {
			seen[id] = true
			ids = append(ids, id)
		}
	}
	out := map[string]*kit.Row{}
	if len(ids) == 0 {
		return out, nil
	}
	stock, err := kit.Query(ctx, h.env.DB, `SELECT id, qty_onhand, avg_cost, satuan_kecil_nama, satuan_besar_nama
		FROM v_raw_materials_stock WHERE id = ANY($1::uuid[])`, ids)
	for _, s := range stock {
		out[s.Str("id")] = s
	}
	return out, err
}

// buildCoverage is buildStockCoverage.
func buildCoverage(materials kit.Rows, stock map[string]*kit.Row, mode string) []coverage {
	out := make([]coverage, 0, len(materials))
	for _, m := range materials {
		required := kit.ToNum(m.Get("qty_planned"))
		if mode == "actual" {
			required = kit.ToNum(jsOr(m.Get("qty_actual"), m.Get("qty_planned")))
		}
		onhand := 0.0
		if s := stock[m.Str("raw_material_id")]; s != nil {
			onhand = s.Num("qty_onhand")
		}
		short := math.Max(0, required-onhand)
		c := coverage{ID: m.Get("id"), RawMaterialID: m.Get("raw_material_id"), RequiredQty: required, QtyOnhand: onhand,
			ShortageQty: short, StockStatus: "ENOUGH", Nama: m.Str("raw_material_id")}
		if short > 0 {
			c.StockStatus = "INSUFFICIENT"
		}
		if rm := embedded(m.Get("raw_material")); rm != nil {
			c.Kode = rm.Str("kode")
			if n := rm.Str("nama"); n != "" {
				c.Nama = n
			}
		}
		out = append(out, c)
	}
	return out
}

// jsOr is `a || b` on numeric text / numbers.
func jsOr(a, b any) any {
	switch x := a.(type) {
	case nil:
		return b
	case string:
		if x == "" {
			return b
		}
	case float64:
		if x == 0 || math.IsNaN(x) {
			return b
		}
	}
	return a
}

// embedded returns an embed already parsed or still raw JSON.
func embedded(v any) *kit.Row {
	if r, ok := v.(*kit.Row); ok {
		return r
	}
	return kit.Embed(v)
}

// checkStock is checkMaterialStock: coverage of the materials not yet
// consumed, with actual quantities overridden by the request.
func (h *handler) checkStock(ctx context.Context, orderID, mode string, overrides map[string]float64) (all, shortages []coverage, err error) {
	rows, err := kit.Query(ctx, h.env.DB, `SELECT "id", "raw_material_id", "qty_planned", "qty_actual", "inventory_movement_id", `+
		kit.EmbedColsSQL("raw_material", `"item"."raw_materials"`, "id", "production_order_materials", "raw_material_id", "kode", "nama")+
		` FROM "production_order_materials" WHERE "production_order_id" = $1`, orderID)
	if err != nil {
		return nil, nil, err
	}
	for _, r := range rows {
		if q, ok := overrides[r.Str("id")]; ok {
			r.Set("qty_actual", q)
		}
	}
	stock, err := h.stockMap(ctx, rows)
	if err != nil {
		return nil, nil, err
	}
	pending := kit.Rows{}
	for _, r := range rows {
		if r.Get("inventory_movement_id") == nil {
			pending = append(pending, r)
		}
	}
	all = buildCoverage(pending, stock, mode)
	shortages = []coverage{}
	for _, c := range all {
		if c.ShortageQty > 0 {
			shortages = append(shortages, c)
		}
	}
	return all, shortages, nil
}

/* GET /api/purchasing/production/orders/{id} */
func (h *handler) getOrder(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.itemsStaff(r); err != nil {
		return err
	}
	ctx := r.Context()
	db := h.env.DB
	id := r.PathValue("id")
	order, err := kit.QueryOne(ctx, db, `SELECT * FROM v_production_orders WHERE id = $1`, id)
	if err != nil || order == nil {
		return httpx.NotFound(orderNotFound)
	}
	materials, err := kit.Query(ctx, db, `SELECT *, `+
		kit.EmbedColsSQL("raw_material", `"item"."raw_materials"`, "id", "production_order_materials", "raw_material_id", "id", "kode", "nama")+`, `+
		kit.EmbedColsSQL("satuan", `"item"."units"`, "id", "production_order_materials", "satuan_id", "id", "kode", "nama")+
		` FROM "production_order_materials" WHERE "production_order_id" = $1 ORDER BY "created_at" ASC`, id)
	if err != nil {
		return err
	}
	batches, err := kit.Query(ctx, db, `SELECT * FROM production_batches WHERE production_order_id = $1 ORDER BY created_at DESC`, id)
	if err != nil {
		return err
	}
	unitName, err := h.outputUnitName(ctx, order)
	if err != nil {
		return err
	}
	stock, err := h.stockMap(ctx, materials)
	if err != nil {
		return err
	}
	cover := buildCoverage(materials, stock, domain.CoverageMode(order.Str("status")))
	byID := map[any]coverage{}
	for _, c := range cover {
		byID[c.ID] = c
	}
	_, skus, err := h.merchandise(ctx, order.Str("product_id"))
	if err != nil {
		return err
	}
	variantOutputs := map[string][]*kit.Row{}
	if len(batches) > 0 {
		outs, err := kit.Query(ctx, db, `SELECT production_batch_id, pos_sku_id, qty FROM production_output_variants WHERE production_order_id = $1`, id)
		if err != nil {
			return err
		}
		var skuIDs []string
		for _, o := range outs {
			skuIDs = append(skuIDs, o.Str("pos_sku_id"))
		}
		labels := map[string]Sku{}
		if len(skuIDs) > 0 {
			if labels, err = h.ports.Pos.SkuLabels(ctx, db, skuIDs); err != nil {
				return err
			}
		}
		for _, o := range outs {
			var sku, name, options any
			if l, ok := labels[o.Str("pos_sku_id")]; ok {
				sku, name, options = l.Sku, l.Name, rawOrNil(l.Options)
			}
			b := o.Str("production_batch_id")
			variantOutputs[b] = append(variantOutputs[b], kit.Obj("pos_sku_id", o.Get("pos_sku_id"), "sku", sku, "name", name,
				"options", options, "qty", o.Get("qty")))
		}
	}
	posSkus := make([]*kit.Row, len(skus))
	for i, s := range skus {
		posSkus[i] = kit.Obj("id", s.ID, "sku", s.Sku, "name", s.Name, "options", rawOrNil(s.Options), "stock_quantity", s.StockQuantity)
	}
	for _, m := range materials {
		sat := embedded(m.Get("satuan"))
		var name string
		if s := stock[m.Str("raw_material_id")]; s != nil {
			name = kit.FirstNonEmpty(s.Str("satuan_kecil_nama"), s.Str("satuan_besar_nama"))
		}
		switch {
		case sat != nil && sat.Str("nama") != "":
		case name != "":
			m.Set("satuan", kit.Obj("id", m.Get("satuan_id"), "nama", name, "kode", nil))
		default:
			m.Set("satuan", nil)
		}
		if c, ok := byID[m.Get("id")]; ok {
			m.Set("stock", c)
		} else {
			m.Set("stock", nil)
		}
	}
	for _, b := range batches {
		outs := variantOutputs[b.Str("id")]
		if outs == nil {
			outs = []*kit.Row{}
		}
		b.Set("variant_outputs", outs)
	}
	insufficient := 0
	for _, c := range cover {
		if c.ShortageQty > 0 {
			insufficient++
		}
	}
	return kit.Data(w, order.Set("output_satuan_nama", unitName).Set("pos_skus", posSkus).Set("variant_required", len(skus) > 0).
		Set("materials", materials).Set("batches", batches).Set("stock_coverage", cover).
		Set("stock_summary", kit.Obj("total_materials", len(cover), "insufficient_materials", insufficient, "can_release", insufficient == 0)))
}

func rawOrNil(b []byte) any {
	if b == nil {
		return nil
	}
	return json.RawMessage(b)
}

// outputUnitName is loadOutputUnitName.
func (h *handler) outputUnitName(ctx context.Context, order *kit.Row) (any, error) {
	if pid := order.Str("product_id"); pid != "" {
		row, err := kit.QueryOne(ctx, h.env.DB, `SELECT `+
			kit.EmbedColsSQL("satuan", `"item"."units"`, "id", "products", "satuan_id", "nama")+` FROM "products" WHERE "id" = $1`, pid)
		if err != nil || row == nil {
			return nil, nil
		}
		if s := embedded(row.Get("satuan")); s != nil && s.Str("nama") != "" {
			return s.Str("nama"), nil
		}
		return nil, nil
	}
	if rid := order.Str("output_raw_material_id"); rid != "" {
		row, err := kit.QueryOne(ctx, h.env.DB, `SELECT satuan_besar_nama, satuan_kecil_nama FROM v_raw_materials_stock WHERE id = $1`, rid)
		if err != nil || row == nil {
			return nil, nil
		}
		if n := kit.FirstNonEmpty(row.Str("satuan_besar_nama"), row.Str("satuan_kecil_nama")); n != "" {
			return n, nil
		}
	}
	return nil, nil
}

// merchandise is resolveVariantContext.
func (h *handler) merchandise(ctx context.Context, productID string) (string, []Sku, error) {
	if productID == "" {
		return "", nil, nil
	}
	return h.ports.Pos.MerchandiseSkus(ctx, h.env.DB, productID)
}

/* ── PATCH actions ───────────────────────────────────────────────────── */

type updateInput struct {
	action                            string
	actualQty                         *float64
	overhead, labor, packaging, waste *float64
	materials                         []materialInput
	variants                          []domain.VariantRow
	variantsSent                      bool
}

type materialInput struct {
	id    string
	qty   float64
	waste *float64
}

func parseUpdate(r *http.Request) (updateInput, error) {
	f := validate.New(validate.ReadBody(r))
	var in updateInput
	if v := kit.Enum(f, "action", validate.Rule{}, []string{"recheck_stock", "release", "start", "complete", "cancel"}, ""); v != nil {
		in.action = *v
	}
	in.actualQty = f.Num("actual_qty", validate.Rule{Optional: true}, validate.NumOpts{Positive: true})
	in.overhead = f.Num("overhead_cost", validate.Rule{Optional: true}, validate.NumOpts{Min: validate.Bound(0)})
	in.labor = f.Num("labor_cost", validate.Rule{Optional: true}, validate.NumOpts{Min: validate.Bound(0)})
	in.packaging = f.Num("packaging_cost", validate.Rule{Optional: true}, validate.NumOpts{Min: validate.Bound(0)})
	in.waste = f.Num("waste_cost", validate.Rule{Optional: true}, validate.NumOpts{Min: validate.Bound(0)})
	f.List("materials", validate.Rule{Optional: true}, math.MaxInt32, func(sub *validate.Form, i int, v any) {
		item := sub.Item(i, v)
		var m materialInput
		if id := item.UUID("id", validate.Rule{}); id != nil {
			m.id = *id
		}
		if q := item.Num("qty_actual", validate.Rule{}, validate.NumOpts{Min: validate.Bound(0)}); q != nil {
			m.qty = *q
		}
		m.waste = item.Num("waste_qty", validate.Rule{Optional: true}, validate.NumOpts{Min: validate.Bound(0)})
		in.materials = append(in.materials, m)
	})
	list := f.List("variant_output", validate.Rule{Optional: true}, 100, func(sub *validate.Form, i int, v any) {
		item := sub.Item(i, v)
		var row domain.VariantRow
		if id := item.UUID("pos_sku_id", validate.Rule{}); id != nil {
			row.PosSkuID = *id
		}
		if q := item.Num("qty", validate.Rule{}, validate.NumOpts{Positive: true}); q != nil {
			row.Qty = *q
		}
		in.variants = append(in.variants, row)
	})
	in.variantsSent = list != nil
	return in, f.Err("Validation failed")
}

// loadOrder is loadProductionOrderForUpdate (with the product embedded).
func (h *handler) loadOrder(ctx context.Context, q database.Querier, id string) (*kit.Row, error) {
	order, err := kit.QueryOne(ctx, q, `SELECT *, `+
		kit.EmbedColsSQL("product", `"item"."products"`, "id", "production_orders", "product_id", "id", "kode", "nama", "satuan_id")+
		` FROM "production_orders" WHERE "id" = $1`, id)
	if err != nil || order == nil {
		return nil, httpx.NotFound(orderNotFound)
	}
	return order, nil
}

/* PATCH /api/purchasing/production/orders/{id} — recheck_stock, release, start, cancel, complete. */
func (h *handler) updateOrder(w http.ResponseWriter, r *http.Request) error {
	u, err := h.itemsStaff(r)
	if err != nil {
		return err
	}
	in, err := parseUpdate(r)
	if err != nil {
		return err
	}
	ctx := r.Context()
	order, err := h.loadOrder(ctx, h.env.DB, r.PathValue("id"))
	if err != nil {
		return err
	}
	status := order.Str("status")
	switch in.action {
	case "recheck_stock":
		all, shortages, err := h.checkStock(ctx, order.Str("id"), domain.CoverageMode(status), nil)
		if err != nil {
			return err
		}
		if _, err := h.env.DB.Exec(ctx, `UPDATE production_orders SET updated_by = $1, updated_at = $2 WHERE id = $3`,
			u.ID, h.env.Now(), order.Get("id")); err != nil {
			return err
		}
		msg := "Stok bahan sudah cukup. " + domain.NextProductionStep(status)
		if len(shortages) > 0 {
			msg = "Masih ada " + kit.JSNum(float64(len(shortages))) + " bahan yang kurang. Buat PO atau terima barang masuk terlebih dahulu."
		}
		return kit.OK(w, kit.Obj("success", true, "data", kit.Obj("can_release", len(shortages) == 0, "total_materials", len(all),
			"insufficient_materials", len(shortages), "shortages", shortages, "coverage", all), "message", msg))
	case "release":
		if status != "DRAFT" {
			return httpx.BadRequest("Hanya produksi DRAFT yang bisa direlease")
		}
		_, shortages, err := h.checkStock(ctx, order.Str("id"), "planned", nil)
		if err != nil {
			return err
		}
		if len(shortages) > 0 {
			return httpx.BadRequest("Stok bahan belum cukup untuk release produksi", kit.Obj("shortages", shortages))
		}
		return h.setStatus(w, r, order, u.ID, kit.Obj("status", "RELEASED"), "Produksi berhasil direlease")
	case "start":
		if status != "RELEASED" {
			return httpx.BadRequest("Hanya produksi RELEASED yang bisa dimulai")
		}
		return h.setStatus(w, r, order, u.ID, kit.Obj("status", "IN_PROGRESS", "started_at", h.env.Now()), "Produksi dimulai")
	case "cancel":
		if status == "COMPLETED" {
			return httpx.BadRequest("Produksi completed tidak bisa dibatalkan")
		}
		return h.setStatus(w, r, order, u.ID, kit.Obj("status", "CANCELLED", "cancelled_at", h.env.Now()), "Produksi dibatalkan")
	}
	return h.complete(w, r, order, u.ID, in)
}

func (h *handler) setStatus(w http.ResponseWriter, r *http.Request, order *kit.Row, userID string, fields *kit.Row, message string) error {
	fields.Set("updated_by", userID).Set("updated_at", h.env.Now())
	rows, err := kit.Update(r.Context(), h.env.DB, "production_orders", fields, func(a *kit.Args) string {
		return `"id" = ` + a.Add(order.Get("id"))
	}, true)
	if err != nil {
		return err
	}
	if len(rows) == 0 {
		return errNoRows
	}
	return kit.OK(w, kit.Obj("success", true, "data", rows[0], "message", message))
}
