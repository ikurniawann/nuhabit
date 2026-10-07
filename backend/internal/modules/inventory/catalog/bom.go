package catalog

import (
	"context"
	"net/http"

	"nuhabit/backend/internal/modules/inventory/domain"
	"nuhabit/backend/internal/modules/inventory/kit"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/validate"
)

// lib/purchasing/bom-api.ts, bom-schemas.ts, bom-cost.ts.

var productBomSelect = `SELECT *, ` +
	kit.EmbedSQL("raw_material", `"item"."raw_materials"`, "id", "bom_items", "raw_material_id") + `, ` +
	kit.EmbedSQL("satuan", `"item"."units"`, "id", "bom_items", "satuan_id") +
	` FROM "manufacturing"."bom_items"`

var rawMaterialBomSelect = `SELECT *, ` +
	kit.EmbedSQL("component", `"item"."raw_materials"`, "id", "raw_material_bom_items", "component_raw_material_id") + `, ` +
	kit.EmbedSQL("satuan", `"item"."units"`, "id", "raw_material_bom_items", "satuan_id") +
	` FROM "manufacturing"."raw_material_bom_items"`

// stockCosts is buildStockCostMap over v_raw_materials_stock for the rows'
// material ids (perSmallUnit divides by konversi when there is a small unit).
func (h *handler) stockCosts(ctx context.Context, rows kit.Rows, idKey string, perSmallUnit bool) (map[string]float64, error) {
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
	stock, err := kit.Query(ctx, h.env.DB, `SELECT id, avg_cost, konversi_factor, satuan_kecil_id FROM v_raw_materials_stock WHERE id = ANY($1::uuid[])`, ids)
	if err != nil {
		return nil, err
	}
	for _, s := range stock {
		cost := s.Num("avg_cost")
		if perSmallUnit {
			cost = domain.SmallUnitCost(cost, s.Num("konversi_factor"), s.Str("satuan_kecil_id") != "")
		}
		out[s.Str("id")] = cost
	}
	return out, nil
}

// fallbackCost is fallbackMaterialCost: avg_cost → harga_avg →
// harga_terakhir of the embedded material (raw_materials has none, so 0).
func fallbackCost(m *kit.Row, perSmallUnit bool) float64 {
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
	cost := kit.ToNum(v)
	if perSmallUnit {
		return domain.SmallUnitCost(cost, kit.ToNum(m.Get("konversi_factor")), m.Str("satuan_kecil_id") != "")
	}
	return cost
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

/* GET /api/purchasing/products/{id}/bom — active recipe lines costed per small unit. */
func (h *handler) listProductBom(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.catalogStaff(r); err != nil {
		return err
	}
	ctx := r.Context()
	rows, err := kit.Query(ctx, h.env.DB, productBomSelect+` WHERE "product_id" = $1 AND "is_active" = $2 ORDER BY "created_at" ASC`, r.PathValue("id"), true)
	if err != nil {
		return err
	}
	// attachMaterialUnits: satuan_besar / satuan_kecil unit rows on the material.
	materials := make([]*kit.Row, len(rows))
	var unitIDs []string
	for i, row := range rows {
		if m := kit.Embed(row.Get("raw_material")); m != nil {
			materials[i] = m
			row.Set("raw_material", m)
			for _, k := range []string{"satuan_besar_id", "satuan_kecil_id"} {
				if id := m.Str(k); id != "" {
					unitIDs = append(unitIDs, id)
				}
			}
		}
	}
	units := map[string]*kit.Row{}
	if len(unitIDs) > 0 {
		list, err := kit.Query(ctx, h.env.DB, `SELECT * FROM units WHERE id = ANY($1::uuid[])`, unitIDs)
		if err != nil {
			return err
		}
		for _, u := range list {
			units[u.Str("id")] = u
		}
	}
	unitOf := func(id string) any {
		if u, ok := units[id]; ok && id != "" {
			return u
		}
		return nil
	}
	for _, m := range materials {
		if m != nil {
			m.Set("satuan_besar", unitOf(m.Str("satuan_besar_id"))).Set("satuan_kecil", unitOf(m.Str("satuan_kecil_id")))
		}
	}
	costs, err := h.stockCosts(ctx, rows, "raw_material_id", true)
	if err != nil {
		return err
	}
	lines, _ := costLines(rows, func(row *kit.Row) float64 {
		if c, ok := costs[row.Str("raw_material_id")]; ok && row.Str("raw_material_id") != "" {
			return c
		}
		m, _ := row.Get("raw_material").(*kit.Row)
		return fallbackCost(m, true)
	})
	return kit.Data(w, lines)
}

// bomQty reads qty and waste: qty_required ?? qty_needed, waste_factor ??
// waste_persen / 100 (sent keys only for updates).
type bomInput struct {
	qty, waste             *float64
	satuan                 *string
	satuanSent, activeSent bool
	active                 bool
}

func parseBom(f *validate.Form, qtyMsg string, legacy, update bool) bomInput {
	var in bomInput
	qtyOpts := kit.Min(0.0001, qtyMsg)
	if !legacy && update {
		qtyOpts = kit.Min(0.0001, "Too small: expected number to be >=0.0001")
	}
	q1 := kit.NumCheck(f, "qty_required", validate.Rule{Optional: true}, qtyOpts)
	var q2 *float64
	if legacy {
		q2 = kit.NumCheck(f, "qty_needed", validate.Rule{Optional: true}, qtyOpts)
	}
	s := f.Str("satuan_id", validate.Rule{Optional: true, Nullable: true}, validate.StrOpts{Check: validate.UUIDCheck})
	_, in.satuanSent = f.Fields()["satuan_id"]
	in.satuan = s
	w1 := f.Num("waste_factor", validate.Rule{Optional: true}, validate.NumOpts{Min: validate.Bound(0), Max: validate.Bound(1)})
	var w2 *float64
	if legacy || !update {
		w2 = f.Num("waste_persen", validate.Rule{Optional: true}, validate.NumOpts{Min: validate.Bound(0), Max: validate.Bound(100)})
	}
	if update {
		if b := f.Bool("is_active", validate.Rule{Optional: true}); b != nil {
			in.activeSent, in.active = true, *b
		}
	}
	in.qty = q1
	if in.qty == nil {
		in.qty = q2
	}
	switch {
	case w1 != nil:
		in.waste = w1
	case w2 != nil:
		in.waste = kit.Ptr(*w2 / 100)
	}
	return in
}

// createColumns is the create transform: qty ?? 0, satuan || null, waste ?? 0.
func (b bomInput) createColumns() (qty float64, satuan any, waste float64) {
	if b.qty != nil {
		qty = *b.qty
	}
	if b.satuan != nil && *b.satuan != "" {
		satuan = *b.satuan
	}
	if b.waste != nil {
		waste = *b.waste
	}
	return
}

/* POST /api/purchasing/products/{id}/bom */
func (h *handler) addProductBom(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.catalogStaff(r); err != nil {
		return err
	}
	f := validate.New(validate.ReadBody(r))
	rm := f.Str("raw_material_id", validate.Rule{}, validate.StrOpts{Check: func(s string) (string, string, bool) {
		return "invalid_format", "Bahan baku wajib dipilih", validate.IsUUID(s)
	}})
	in := parseBom(f, "Jumlah harus lebih dari 0", true, false)
	qty, satuan, waste := in.createColumns()
	if f.Valid() && !(qty > 0) {
		f.Fail("qty_required", "custom", "Jumlah harus lebih dari 0")
	}
	if err := kit.FirstIssueErr(f); err != nil {
		return err
	}
	ctx := r.Context()
	productID := r.PathValue("id")
	if p, err := kit.QueryOne(ctx, h.env.DB, `SELECT id FROM products WHERE id = $1`, productID); err != nil || p == nil {
		return httpx.NotFound(productNotFound)
	}
	m, err := kit.QueryOne(ctx, h.env.DB, `SELECT id, source_product_id::text FROM raw_materials WHERE id = $1 AND is_active = true`, *rm)
	if err != nil || m == nil {
		return httpx.NotFound(materialNotFound)
	}
	if m.Str("source_product_id") == productID {
		return httpx.BadRequest("Produk tidak boleh memakai WIP dari produk yang sama sebagai BOM")
	}
	if dup, _ := kit.QueryOne(ctx, h.env.DB, `SELECT id FROM manufacturing.bom_items WHERE product_id = $1 AND raw_material_id = $2
		AND is_active = true LIMIT 1`, productID, *rm); dup != nil {
		return httpx.BadRequest("Bahan ini sudah ada di BOM produk")
	}
	row, err := kit.InsertOne(ctx, h.env.DB, `"manufacturing"."bom_items"`, kit.Obj("raw_material_id", *rm, "qty_required", qty,
		"satuan_id", satuan, "waste_factor", waste, "product_id", productID, "is_active", true))
	if err != nil {
		return err
	}
	return httpx.JSON(w, http.StatusCreated, kit.Obj("success", true, "data", row, "message", "Bahan berhasil ditambahkan ke BOM"))
}

/* PUT /api/purchasing/bom/{id} — only the sent fields. */
func (h *handler) updateProductBom(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.catalogStaff(r); err != nil {
		return err
	}
	f := validate.New(validate.ReadBody(r))
	in := parseBom(f, "Jumlah harus lebih dari 0", true, true)
	if err := kit.FirstIssueErr(f); err != nil {
		return err
	}
	set := kit.NewRow()
	if in.qty != nil {
		set.Set("qty_required", *in.qty)
	}
	if in.satuanSent {
		set.Set("satuan_id", ptrAny(in.satuan))
	}
	if in.waste != nil {
		set.Set("waste_factor", *in.waste)
	}
	if in.activeSent {
		set.Set("is_active", in.active)
	}
	return h.updateBom(w, r, `"manufacturing"."bom_items"`, set, "Item BOM tidak ditemukan", "Item BOM berhasil diupdate")
}

func (h *handler) updateBom(w http.ResponseWriter, r *http.Request, table string, set *kit.Row, notFound, message string) error {
	ctx := r.Context()
	id := r.PathValue("id")
	if found, err := kit.QueryOne(ctx, h.env.DB, `SELECT id FROM `+table+` WHERE id = $1`, id); err != nil || found == nil {
		return httpx.NotFound(notFound)
	}
	rows, err := kit.Update(ctx, h.env.DB, table, set.Set("updated_at", h.env.Now()), func(a *kit.Args) string { return `"id" = ` + a.Add(id) }, true)
	if err != nil {
		return err
	}
	if len(rows) == 0 {
		return errNoRows
	}
	return kit.OK(w, kit.Obj("success", true, "data", rows[0], "message", message))
}

/* DELETE /api/purchasing/bom/{id} — soft delete. */
func (h *handler) deleteProductBom(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.catalogStaff(r); err != nil {
		return err
	}
	id := r.PathValue("id")
	if _, err := kit.Update(r.Context(), h.env.DB, `"manufacturing"."bom_items"`, kit.Obj("is_active", false),
		func(a *kit.Args) string { return `"id" = ` + a.Add(id) }, false); err != nil {
		return err
	}
	return kit.OK(w, kit.Obj("success", true, "message", "Bahan berhasil dihapus dari BOM"))
}

/* ── raw material BOM ────────────────────────────────────────────────── */

/* GET /api/purchasing/raw-materials/{id}/bom */
func (h *handler) listRawMaterialBom(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.itemsStaff(r); err != nil {
		return err
	}
	ctx := r.Context()
	rows, err := kit.Query(ctx, h.env.DB, rawMaterialBomSelect+` WHERE "output_raw_material_id" = $1 AND "is_active" = $2 ORDER BY "created_at" ASC`,
		r.PathValue("id"), true)
	if err != nil {
		return err
	}
	for _, row := range rows {
		row.Set("raw_material_id", row.Get("component_raw_material_id")).Set("raw_material", row.Get("component"))
	}
	costs, err := h.stockCosts(ctx, rows, "component_raw_material_id", true)
	if err != nil {
		return err
	}
	lines, _ := costLines(rows, func(row *kit.Row) float64 { return costs[row.Str("component_raw_material_id")] })
	return kit.Data(w, lines)
}

func (h *handler) requireActiveMaterial(ctx context.Context, id, msg string) error {
	row, err := kit.QueryOne(ctx, h.env.DB, `SELECT id FROM raw_materials WHERE id = $1 AND is_active = true AND deleted_at IS NULL`, id)
	if err != nil || row == nil {
		return httpx.NotFound(msg)
	}
	return nil
}

/* POST /api/purchasing/raw-materials/{id}/bom */
func (h *handler) addRawMaterialBom(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.itemsStaff(r); err != nil {
		return err
	}
	f := validate.New(validate.ReadBody(r))
	component := f.Str("component_raw_material_id", validate.Rule{}, validate.StrOpts{Check: func(s string) (string, string, bool) {
		return "invalid_format", "Component raw material is required", validate.IsUUID(s)
	}})
	in := parseBom(f, "Quantity must be greater than 0", false, false)
	qty, satuan, waste := in.createColumns()
	if f.Valid() && !(qty > 0) {
		f.Fail("qty_required", "custom", "Quantity must be greater than 0")
	}
	if err := kit.FirstIssueErr(f); err != nil {
		return err
	}
	ctx := r.Context()
	output := r.PathValue("id")
	if *component == output {
		return httpx.BadRequest("A raw material cannot be a component of itself")
	}
	if err := h.requireActiveMaterial(ctx, output, "Output raw material not found"); err != nil {
		return err
	}
	if err := h.requireActiveMaterial(ctx, *component, "Component raw material not found"); err != nil {
		return err
	}
	if dup, _ := kit.QueryOne(ctx, h.env.DB, `SELECT id FROM manufacturing.raw_material_bom_items WHERE output_raw_material_id = $1
		AND component_raw_material_id = $2 AND is_active = true LIMIT 1`, output, *component); dup != nil {
		return httpx.BadRequest("This component is already in the bill of materials")
	}
	row, err := kit.InsertOne(ctx, h.env.DB, `"manufacturing"."raw_material_bom_items"`, kit.Obj("output_raw_material_id", output,
		"component_raw_material_id", *component, "qty_required", qty, "satuan_id", satuan, "waste_factor", waste, "is_active", true))
	if err != nil {
		return err
	}
	return httpx.JSON(w, http.StatusCreated, kit.Obj("success", true, "data", row, "message", "Component added to bill of materials"))
}

/* PUT /api/purchasing/raw-material-bom/{id} */
func (h *handler) updateRawMaterialBom(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.itemsStaff(r); err != nil {
		return err
	}
	f := validate.New(validate.ReadBody(r))
	set := kit.NewRow()
	optionalNum(f, set, "qty_required", validate.Rule{Optional: true}, validate.NumOpts{Min: validate.Bound(0.0001)})
	optionalStr(f, set, "satuan_id", validate.Rule{Optional: true, Nullable: true}, validate.StrOpts{Check: validate.UUIDCheck})
	optionalNum(f, set, "waste_factor", validate.Rule{Optional: true}, validate.NumOpts{Min: validate.Bound(0), Max: validate.Bound(1)})
	optionalBool(f, set, "is_active")
	if err := kit.FirstIssueErr(f); err != nil {
		return err
	}
	return h.updateBom(w, r, `"manufacturing"."raw_material_bom_items"`, set, "Bill of materials item not found", "Bill of materials item updated")
}

/* DELETE /api/purchasing/raw-material-bom/{id} */
func (h *handler) deleteRawMaterialBom(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.itemsStaff(r); err != nil {
		return err
	}
	id := r.PathValue("id")
	if _, err := kit.Update(r.Context(), h.env.DB, `"manufacturing"."raw_material_bom_items"`, kit.Obj("is_active", false, "updated_at", h.env.Now()),
		func(a *kit.Args) string { return `"id" = ` + a.Add(id) }, false); err != nil {
		return err
	}
	return kit.OK(w, kit.Obj("success", true, "message", "Bill of materials item removed"))
}
