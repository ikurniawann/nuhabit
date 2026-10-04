package catalog

import (
	"context"
	"encoding/json"
	"math"
	"net/http"
	"strings"

	"nuhabit/backend/internal/modules/inventory/domain"
	"nuhabit/backend/internal/modules/inventory/kit"
	"nuhabit/backend/internal/platform/httpx"
	ps "nuhabit/backend/internal/platform/scope"
	"nuhabit/backend/internal/platform/stall"
	"nuhabit/backend/internal/platform/validate"
)

// lib/purchasing/product-api.ts, product-api-schemas.ts, product-hpp-review.ts.

const productNotFound = "Produk tidak ditemukan"

// withHppReview is withProductHppReview: harga_modal and hpp_estimasi
// become numbers, the review fields are appended.
func withHppReview(row *kit.Row) *kit.Row {
	est := row.Get("hpp_estimasi")
	if est == nil {
		est = row.Get("estimated_cogs")
	}
	r := domain.BuildHppReview(row.Num("harga_modal"), kit.ToNum(est), row.Num("total_bahan_baku"))
	return row.Set("harga_modal", r.HargaModal).Set("hpp_estimasi", r.HppEstimasi).Set("hpp_tersimpan", r.HppTersimpan).
		Set("hpp_resep", r.HppResep).Set("hpp_selisih", r.HppSelisih).Set("hpp_perlu_review", r.PerluReview)
}

func (h *handler) attachVariantCounts(ctx context.Context, rows kit.Rows) (kit.Rows, error) {
	if len(rows) == 0 {
		return kit.Rows{}, nil
	}
	ids := make([]string, len(rows))
	for i, r := range rows {
		ids[i] = r.Str("id")
	}
	counts, err := h.ports.Pos.VariantCounts(ctx, h.env.DB, ids)
	if err != nil {
		return nil, err
	}
	for _, r := range rows {
		r.Set("variant_count", counts[r.Str("id")])
	}
	return rows, nil
}

/* GET /api/purchasing/products */
func (h *handler) listProducts(w http.ResponseWriter, r *http.Request) error {
	u, scope, err := h.staffScope(r, h.catalogStaff)
	if err != nil {
		return err
	}
	ctx := r.Context()
	sp := r.URL.Query()
	warehouseID := sp.Get("warehouse_id")
	if !sp.Has("warehouse_id") {
		if warehouseID, err = stall.Active(ctx, h.env.DB, r, u.ID); err != nil {
			return err
		}
	}
	page, limit := kit.IntParam(sp, "page", "1"), kit.IntParam(sp, "limit", "20")
	hppReview := sp.Get("hpp_review") == "true"
	a := &kit.Args{}
	where := []string{`"deleted_at" IS NULL`}
	if hppReview {
		where = append(where, `"total_bahan_baku" > `+a.Add(0))
	}
	if warehouseID != "" {
		where = append(where, `"warehouse_id" = `+a.Add(warehouseID))
	}
	if sp.Has("is_active") {
		where = append(where, `"is_active" = `+a.Add(sp.Get("is_active") == "true"))
	}
	where = append(kit.ScopeFilters(scope, "", a, nil), where...)
	if s := sp.Get("search"); s != "" {
		where = append(where, kit.Search(a, "", s, "nama", "kode"))
	}
	from, to := (page-1)*limit, (page-1)*limit+limit-1
	if hppReview {
		rows, err := kit.Query(ctx, h.env.DB, `SELECT * FROM v_products_cogs WHERE `+strings.Join(where, " AND ")+` ORDER BY "nama" ASC LIMIT 1000`, a.Values...)
		if err != nil {
			return err
		}
		reviewed := kit.Rows{}
		for _, row := range rows {
			if withHppReview(row).Bool("hpp_perlu_review") {
				reviewed = append(reviewed, row)
			}
		}
		start, end := kit.SliceBounds(len(reviewed), from, to+1)
		data, err := h.attachVariantCounts(ctx, reviewed[start:end])
		if err != nil {
			return err
		}
		return h.productList(w, data, pagination(page, limit, len(reviewed), math.Max(1, math.Ceil(float64(len(reviewed))/limit))))
	}
	rows, total, err := h.pageList(ctx, "v_products_cogs", where, a, `"nama" ASC`, page, limit)
	if err != nil {
		return err
	}
	for _, row := range rows {
		withHppReview(row)
	}
	data, err := h.attachVariantCounts(ctx, rows)
	if err != nil {
		return err
	}
	return h.productList(w, data, pagination(page, limit, total, math.Ceil(float64(total)/limit)))
}

func (h *handler) productList(w http.ResponseWriter, data kit.Rows, p listPagination) error {
	return kit.OK(w, struct {
		Success    bool           `json:"success"`
		Data       kit.Rows       `json:"data"`
		Pagination listPagination `json:"pagination"`
	}{true, data, p})
}

func inScope(scope *ps.Scope, row *kit.Row) bool {
	return ps.RowInScope(scope, row.StrPtr("company_id"), row.StrPtr("branch_id"))
}

/* GET /api/purchasing/products/{id} — detail + costed BOM. */
func (h *handler) getProduct(w http.ResponseWriter, r *http.Request) error {
	_, scope, err := h.staffScope(r, h.itemsStaff)
	if err != nil {
		return err
	}
	ctx := r.Context()
	id := r.PathValue("id")
	product, err := kit.QueryOne(ctx, h.env.DB, `SELECT * FROM v_products_cogs WHERE id = $1`, id)
	if err != nil {
		return err
	}
	if product == nil || !inScope(scope, product) {
		return httpx.NotFound(productNotFound)
	}
	rows, err := kit.Query(ctx, h.env.DB, productBomSelect+` WHERE "product_id" = $1 AND "is_active" = $2 ORDER BY "created_at" ASC`, id, true)
	if err != nil {
		return err
	}
	costs, err := h.stockCosts(ctx, rows, "raw_material_id", false)
	if err != nil {
		return err
	}
	lines, total := costLines(rows, func(row *kit.Row) float64 {
		if c, ok := costs[row.Str("raw_material_id")]; ok {
			return c
		}
		return fallbackCost(kit.Embed(row.Get("raw_material")), false)
	})
	return kit.Data(w, withHppReview(product).Set("bom_items", lines).Set("hpp_calculated", total))
}

/* ── create / update ─────────────────────────────────────────────────── */

// coerceNum is z.coerce.number() on a JSON value: Number(value).
func coerceNum(f *validate.Form, key string, r validate.Rule, o validate.NumOpts) *float64 {
	v, sent := f.Fields()[key]
	if !sent {
		return nil
	}
	n := 0.0
	switch x := v.(type) {
	case nil:
	case json.Number:
		n, _ = x.Float64()
	case string:
		n = kit.JSNumber(x)
	case bool:
		if x {
			n = 1
		}
	default:
		n = math.NaN()
	}
	if math.IsNaN(n) {
		f.Fail(key, "invalid_type", "Invalid input: expected number, received NaN")
		return nil
	}
	x, ok := f.CheckNumber(key, json.Number(kit.JSNum(n)), o)
	if !ok {
		return nil
	}
	return &x
}

func (h *handler) syncToPos(ctx context.Context, productID, outputType, station string, costOverride *float64) any {
	if outputType != "FINISHED_GOOD" {
		return nil
	}
	res, err := h.ports.Pos.SyncProduct(ctx, h.env.DB, productID, station, costOverride)
	if err != nil {
		h.env.Log.WarnContext(ctx, "POS sync failed", "product_id", productID, "error", err)
		return nil
	}
	return res
}

func syncMessage(sync any, synced, plain string) string {
	if sync != nil {
		return synced
	}
	return plain
}

/* POST /api/purchasing/products */
func (h *handler) createProduct(w http.ResponseWriter, r *http.Request) error {
	_, scope, err := h.staffScope(r, h.itemsStaff)
	if err != nil {
		return err
	}
	f := validate.New(validate.ReadBody(r))
	kodeIn := f.Str("kode", validate.Rule{Optional: true}, validate.StrOpts{Max: 20})
	nama := f.Str("nama", validate.Rule{}, validate.StrOpts{Check: minLen(1, "Nama produk wajib diisi"), Max: 100})
	desc := f.Str("deskripsi", validate.Rule{Optional: true}, validate.StrOpts{})
	kategori := f.Str("kategori", validate.Rule{Optional: true}, validate.StrOpts{})
	satuan := f.UUID("satuan_id", validate.Rule{Optional: true})
	warehouse := f.Str("warehouse_id", validate.Rule{}, validate.StrOpts{Check: func(s string) (string, string, bool) {
		return "invalid_format", "Stall wajib dipilih", validate.IsUUID(s)
	}})
	hargaJual := coerceNum(f, "harga_jual", validate.Rule{}, validate.NumOpts{Min: validate.Bound(0)})
	hargaModal := coerceNum(f, "harga_modal", validate.Rule{}, validate.NumOpts{Min: validate.Bound(0)})
	markup := coerceNum(f, "markup_persen", validate.Rule{}, validate.NumOpts{})
	output := kit.Enum(f, "production_output_type", validate.Rule{HasDefault: true}, []string{"FINISHED_GOOD", "WIP"}, "")
	station := kit.Enum(f, "station", validate.Rule{HasDefault: true}, domain.PosStations, "")
	if err := kit.FirstIssueErr(f); err != nil {
		return err
	}
	ctx := r.Context()
	ws, msg, err := kit.ValidateProductWarehouse(ctx, h.env.DB, *warehouse, scope)
	if err != nil {
		return err
	}
	if msg != "" {
		return httpx.BadRequest(msg)
	}
	a := &kit.Args{}
	scoped := ` AND warehouse_id = ` + a.Add(ws.WarehouseID) + ` AND deleted_at IS NULL` +
		scopeEq(a, "company_id", &ws.CompanyID) + scopeEq(a, "branch_id", &ws.BranchID)
	kode := kit.Deref(kodeIn)
	if kode == "" {
		prefix := "PRD-" + h.env.Now().UTC().Format("20060102")
		last, err := kit.QueryOne(ctx, h.env.DB, `SELECT kode FROM products WHERE kode LIKE `+a.Add(prefix+"-%")+scoped+
			` ORDER BY kode DESC LIMIT 1`, a.Values...)
		if err != nil {
			return err
		}
		lastCode := ""
		if last != nil {
			lastCode = last.Str("kode")
		}
		kode = domain.NextSequentialCode(prefix, lastCode, 3)
	} else if dup, err := kit.QueryOne(ctx, h.env.DB, `SELECT id FROM products WHERE kode = `+a.Add(kode)+scoped+` LIMIT 1`, a.Values...); err != nil {
		return err
	} else if dup != nil {
		return httpx.BadRequest("Kode produk sudah digunakan di stall ini")
	}
	jual := 0.0
	if hargaJual != nil {
		jual = *hargaJual
	}
	outputType, stationIn := "FINISHED_GOOD", "kitchen"
	if output != nil {
		outputType = *output
	}
	if station != nil {
		stationIn = *station
	}
	row, err := kit.InsertOne(ctx, h.env.DB, "products", kit.Obj(
		"nama", *nama, "deskripsi", ptrAny(desc), "kategori", ptrAny(kategori), "satuan_id", ptrAny(satuan),
		"harga_jual", jual, "harga_modal", numAny(hargaModal), "markup_persen", numAny(markup),
		"production_output_type", outputType, "station", domain.ResolvePosStation(stationIn, kit.Deref(kategori)),
		"kode", kode, "company_id", ws.CompanyID, "branch_id", ws.BranchID, "warehouse_id", ws.WarehouseID, "is_active", true))
	if err != nil {
		return err
	}
	rowOutput := kit.FirstNonEmpty(row.Str("production_output_type"), "FINISHED_GOOD")
	sync := h.syncToPos(ctx, row.Str("id"), rowOutput, domain.ResolvePosStation(row.Str("station"), row.Str("kategori")), nil)
	return httpx.JSON(w, http.StatusCreated, kit.Obj("success", true, "data", row, "pos_sync", sync,
		"message", syncMessage(sync, "Produk berhasil ditambahkan dan tersinkron ke POS", "Produk berhasil ditambahkan")))
}

func ptrAny(s *string) any {
	if s == nil {
		return nil
	}
	return *s
}

func numAny(f *float64) any {
	if f == nil {
		return nil
	}
	return *f
}

func (h *handler) activeProduct(ctx context.Context, id string) (*kit.Row, error) {
	row, err := kit.QueryOne(ctx, h.env.DB, `SELECT * FROM products WHERE id = $1 AND deleted_at IS NULL`, id)
	if err != nil || row == nil {
		return nil, httpx.NotFound(productNotFound)
	}
	return row, nil
}

/* PUT /api/purchasing/products/{id} */
func (h *handler) updateProduct(w http.ResponseWriter, r *http.Request) error {
	_, scope, err := h.staffScope(r, h.itemsStaff)
	if err != nil {
		return err
	}
	f := validate.New(validate.ReadBody(r))
	set := kit.NewRow()
	optionalStr(f, set, "nama", validate.Rule{Optional: true}, validate.StrOpts{Min: 1, Max: 100})
	optionalStr(f, set, "deskripsi", validate.Rule{Optional: true, Nullable: true}, validate.StrOpts{})
	optionalStr(f, set, "kategori", validate.Rule{Optional: true, Nullable: true}, validate.StrOpts{})
	optionalStr(f, set, "satuan_id", validate.Rule{Optional: true, Nullable: true}, validate.StrOpts{Check: validate.UUIDCheck})
	optionalStr(f, set, "warehouse_id", validate.Rule{Optional: true}, validate.StrOpts{Check: validate.UUIDCheck})
	for _, k := range []string{"harga_jual", "harga_modal"} {
		if v := coerceNum(f, k, validate.Rule{}, validate.NumOpts{Min: validate.Bound(0)}); v != nil {
			set.Set(k, *v)
		}
	}
	if v := coerceNum(f, "markup_persen", validate.Rule{}, validate.NumOpts{}); v != nil {
		set.Set("markup_persen", *v)
	}
	optionalBool(f, set, "is_active")
	if v := kit.Enum(f, "production_output_type", validate.Rule{Optional: true}, []string{"FINISHED_GOOD", "WIP"}, ""); v != nil {
		set.Set("production_output_type", *v)
	}
	stationSent, stationVal := f.Fields()["station"]
	if v := kit.Enum(f, "station", validate.Rule{Optional: true, Nullable: true}, domain.PosStations, ""); v != nil {
		set.Set("station", *v)
	} else if stationVal && stationSent == nil {
		set.Set("station", nil)
	}
	if err := kit.FirstIssueErr(f); err != nil {
		return err
	}
	ctx := r.Context()
	id := r.PathValue("id")
	existing, err := h.activeProduct(ctx, id)
	if err != nil {
		return err
	}
	if !inScope(scope, existing) {
		return httpx.NotFound(productNotFound)
	}
	coalesce := func(key string) string {
		if s, ok := set.Get(key).(string); ok {
			return s
		}
		return existing.Str(key)
	}
	set.Set("station", domain.ResolvePosStation(coalesce("station"), coalesce("kategori"))).Set("updated_at", h.env.Now())
	if wid := set.Str("warehouse_id"); wid != "" && wid != existing.Str("warehouse_id") {
		ws, msg, err := kit.ValidateProductWarehouse(ctx, h.env.DB, wid, scope)
		if err != nil {
			return err
		}
		if msg != "" {
			return httpx.BadRequest(msg)
		}
		set.Set("company_id", ws.CompanyID).Set("branch_id", ws.BranchID).Set("warehouse_id", ws.WarehouseID)
	}
	rows, err := kit.Update(ctx, h.env.DB, "products", set, func(a *kit.Args) string {
		return `"id" = ` + a.Add(id) + ` AND "deleted_at" IS NULL`
	}, true)
	if err != nil {
		return err
	}
	if len(rows) == 0 {
		return errNoRows
	}
	row := rows[0]
	output := kit.FirstNonEmpty(row.Str("production_output_type"), existing.Str("production_output_type"), "FINISHED_GOOD")
	station := domain.ResolvePosStation(firstNonNil(row, existing, "station"), firstNonNil(row, existing, "kategori"))
	sync := h.syncToPos(ctx, id, output, station, nil)
	return kit.OK(w, kit.Obj("success", true, "data", row, "pos_sync", sync,
		"message", syncMessage(sync, "Produk berhasil diupdate dan tersinkron ke POS", "Produk berhasil diupdate")))
}

// firstNonNil is `a[key] ?? b[key]` on string columns.
func firstNonNil(a, b *kit.Row, key string) string {
	if a.Get(key) != nil {
		return a.Str(key)
	}
	return b.Str(key)
}

/* DELETE /api/purchasing/products/{id} — soft delete (no scope check, as in TS). */
func (h *handler) deleteProduct(w http.ResponseWriter, r *http.Request) error {
	u, err := h.itemsStaff(r)
	if err != nil {
		return err
	}
	ctx := r.Context()
	id := r.PathValue("id")
	if _, err := h.activeProduct(ctx, id); err != nil {
		return err
	}
	now := h.env.Now()
	if _, err := kit.Update(ctx, h.env.DB, "products", kit.Obj("is_active", false, "deleted_at", now, "deleted_by", u.ID, "updated_at", now),
		func(a *kit.Args) string { return `"id" = ` + a.Add(id) + ` AND "deleted_at" IS NULL` }, false); err != nil {
		return err
	}
	return kit.OK(w, kit.Obj("success", true, "message", "Produk berhasil dihapus"))
}

/* POST /api/purchasing/products/{id}/apply-recipe-hpp — harga_modal ← recipe HPP. */
func (h *handler) applyRecipeHpp(w http.ResponseWriter, r *http.Request) error {
	_, scope, err := h.staffScope(r, h.itemsStaff)
	if err != nil {
		return err
	}
	ctx := r.Context()
	id := r.PathValue("id")
	product, err := kit.QueryOne(ctx, h.env.DB, `SELECT * FROM v_products_cogs WHERE id = $1 AND deleted_at IS NULL`, id)
	if err != nil || product == nil {
		return httpx.NotFound(productNotFound)
	}
	if !inScope(scope, product) {
		return httpx.NotFound(productNotFound)
	}
	est := product.Get("hpp_estimasi")
	if est == nil {
		est = product.Get("estimated_cogs")
	}
	review := domain.BuildHppReview(product.Num("harga_modal"), kit.ToNum(est), product.Num("total_bahan_baku"))
	if review.HppResep <= 0 {
		return httpx.BadRequest("HPP seharusnya belum bisa dihitung. Lengkapi BOM dan biaya bahan dulu.")
	}
	if !review.PerluReview {
		return httpx.BadRequest("HPP saat ini sudah sama dengan HPP seharusnya.")
	}
	rows, err := kit.Update(ctx, h.env.DB, "products", kit.Obj("harga_modal", review.HppResep, "updated_at", h.env.Now()),
		func(a *kit.Args) string { return `"id" = ` + a.Add(id) + ` AND "deleted_at" IS NULL` }, true)
	if err != nil {
		return err
	}
	if len(rows) == 0 {
		return errNoRows
	}
	updated := rows[0]
	output := kit.FirstNonEmpty(updated.Str("production_output_type"), product.Str("production_output_type"), "FINISHED_GOOD")
	kategori := kit.FirstNonEmpty(updated.Str("kategori"), product.Str("kategori"))
	station := domain.ResolvePosStation(firstNonNil(updated, product, "station"), kategori)
	sync := h.syncToPos(ctx, id, output, station, &review.HppResep)
	totalBahan := product.Num("total_bahan_baku")
	if updated.Has("total_bahan_baku") {
		totalBahan = updated.Num("total_bahan_baku")
	}
	refreshed := domain.BuildHppReview(review.HppResep, review.HppEstimasi, totalBahan)
	data := updated.Set("harga_modal", refreshed.HargaModal).Set("hpp_estimasi", refreshed.HppEstimasi).
		Set("hpp_tersimpan", refreshed.HppTersimpan).Set("hpp_resep", refreshed.HppResep).
		Set("hpp_selisih", refreshed.HppSelisih).Set("hpp_perlu_review", refreshed.PerluReview)
	amount := domain.FormatRupiah(review.HppResep)
	return kit.OK(w, kit.Obj("success", true, "data", data, "pos_sync", sync,
		"message", syncMessage(sync, "HPP diperbarui ke "+amount+" dan tersinkron ke POS.", "HPP diperbarui ke "+amount+".")))
}
