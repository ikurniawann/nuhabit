package catalog

import (
	"context"
	"errors"
	"math"
	"net/http"
	"strings"

	"nuhabit/backend/internal/modules/inventory/domain"
	"nuhabit/backend/internal/modules/inventory/kit"
	"nuhabit/backend/internal/platform/httpx"
	ps "nuhabit/backend/internal/platform/scope"
	"nuhabit/backend/internal/platform/validate"
)

// lib/purchasing/raw-material-api-legacy.ts and supply-items-api.ts.

/* GET /api/purchasing/materials */
func (h *handler) listLegacyMaterials(w http.ResponseWriter, r *http.Request) error {
	_, scope, err := h.staffScope(r, h.itemsStaff)
	if err != nil {
		return err
	}
	f := kit.NewQueryForm(r.URL.Query())
	search := f.Str("search", validate.Rule{Optional: true}, validate.StrOpts{})
	kategori := f.Str("kategori", validate.Rule{Optional: true}, validate.StrOpts{})
	page := f.Coerce("page", kit.Ptr(1.0), validate.NumOpts{Min: validate.Bound(1)})
	limit := f.Coerce("limit", kit.Ptr(20.0), validate.NumOpts{Min: validate.Bound(1), Max: validate.Bound(100)})
	if err := kit.FirstIssueErr(f.Form); err != nil {
		return err
	}
	a := &kit.Args{}
	where := []string{`"deleted_at" IS NULL`, `"is_active" = ` + a.Add(true)}
	where = kit.ScopeFilters(scope, "", a, where)
	if search != nil && *search != "" {
		where = append(where, kit.Search(a, "", *search, "nama", "kode", "kategori"))
	}
	if kategori != nil && *kategori != "" {
		where = append(where, `"kategori" = `+a.Add(*kategori))
	}
	rows, total, err := h.pageList(r.Context(), "raw_materials", where, a, `"nama" ASC`, *page, *limit)
	if err != nil {
		return err
	}
	type meta struct {
		Page       kit.Float `json:"page"`
		Limit      kit.Float `json:"limit"`
		Total      int       `json:"total"`
		TotalPages kit.Float `json:"totalPages"`
	}
	return kit.Paginated(w, rows, meta{kit.Float(*page), kit.Float(*limit), total, kit.Float(math.Ceil(float64(total) / *limit))}, "")
}

/* POST /api/purchasing/materials — the old unchecked body, read as is. */
func (h *handler) createLegacyMaterial(w http.ResponseWriter, r *http.Request) error {
	u, scope, err := h.staffScope(r, h.itemsStaff)
	if err != nil {
		return err
	}
	raw, ok := validate.ReadBody(r)
	body, isObj := raw.(map[string]any)
	if !ok || raw == nil {
		return errors.New("invalid JSON body") // request.json() / property access throws in TS
	}
	if !isObj {
		body = map[string]any{}
	}
	get := func(k string) any { return body[k] }
	truthy := func(v any) bool { return v != nil && v != "" && v != false && v != 0.0 }
	besar := get("satuan_besar_id")
	if !truthy(besar) {
		besar = get("satuan_id")
	}
	if !truthy(besar) {
		return httpx.BadRequest("satuan_id atau satuan_besar_id wajib diisi")
	}
	or := func(k string, def any) any {
		if v := get(k); v != nil {
			return jsonValue(v)
		}
		return def
	}
	kategori := get("kategori")
	if !truthy(kategori) {
		kategori = "LAINNYA"
	}
	cols := kit.Obj("kode", jsonValue(get("kode")), "nama", jsonValue(get("nama")), "kategori", jsonValue(kategori),
		"deskripsi", or("deskripsi", nil), "satuan_besar_id", jsonValue(besar), "satuan_kecil_id", or("satuan_kecil_id", nil),
		"konversi_factor", or("konversi_factor", 1.0), "stok_minimum", or("stok_minimum", 0.0), "stok_maximum", or("stok_maximum", 0.0),
		"company_id", ps.EffectiveCompanyID(scope), "branch_id", ps.EffectiveBranchID(scope), "created_by", u.ID)
	row, err := kit.InsertOne(r.Context(), h.env.DB, "raw_materials", cols)
	if err != nil {
		return err
	}
	return httpx.DataMessage(w, http.StatusOK, row, "Bahan baku berhasil dibuat")
}

// jsonValue turns a decoded JSON number into float64 for kit.Param.
func jsonValue(v any) any {
	if n, ok := v.(interface{ Float64() (float64, error) }); ok {
		f, _ := n.Float64()
		return f
	}
	return v
}

/* GET /api/purchasing/materials/{id} */
func (h *handler) getLegacyMaterial(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.itemsStaff(r); err != nil {
		return err
	}
	row, err := h.activeMaterial(r.Context(), r.PathValue("id"))
	if err != nil {
		return err
	}
	return kit.Data(w, row)
}

/* PUT /api/purchasing/materials/{id} */
func (h *handler) updateLegacyMaterial(w http.ResponseWriter, r *http.Request) error {
	u, err := h.itemsStaff(r)
	if err != nil {
		return err
	}
	f := validate.New(validate.ReadBody(r))
	nama := f.Str("nama", validate.Rule{Optional: true}, validate.StrOpts{Min: 1})
	kode := f.Str("kode", validate.Rule{Optional: true}, validate.StrOpts{Min: 1})
	kategori := f.Str("kategori", validate.Rule{Optional: true}, validate.StrOpts{})
	satuan := f.UUID("satuan_id", validate.Rule{Optional: true})
	besar := f.UUID("satuan_besar_id", validate.Rule{Optional: true})
	active := f.Bool("is_active", validate.Rule{Optional: true})
	if err := kit.FirstIssueErr(f); err != nil {
		return err
	}
	set := kit.Obj("updated_by", u.ID)
	if nama != nil {
		set.Set("nama", *nama)
	}
	if kode != nil {
		set.Set("kode", *kode)
	}
	if kategori != nil {
		set.Set("kategori", *kategori)
	}
	if active != nil {
		set.Set("is_active", *active)
	}
	if b := kit.FirstNonEmpty(kit.Deref(besar), kit.Deref(satuan)); b != "" {
		set.Set("satuan_besar_id", b)
	}
	id := r.PathValue("id")
	rows, err := kit.Update(r.Context(), h.env.DB, "raw_materials", set, func(a *kit.Args) string {
		return `"id" = ` + a.Add(id) + ` AND "deleted_at" IS NULL`
	}, true)
	if err != nil || len(rows) == 0 {
		return httpx.NotFound(materialNotFound)
	}
	return httpx.DataMessage(w, http.StatusOK, rows[0], "Bahan baku berhasil diperbarui")
}

/* DELETE /api/purchasing/materials/{id} — 204. */
func (h *handler) deleteLegacyMaterial(w http.ResponseWriter, r *http.Request) error {
	u, err := h.itemsStaff(r)
	if err != nil {
		return err
	}
	id := r.PathValue("id")
	if _, err := kit.Update(r.Context(), h.env.DB, "raw_materials",
		kit.Obj("is_active", false, "deleted_at", h.env.Now(), "deleted_by", u.ID, "updated_by", u.ID),
		func(a *kit.Args) string { return `"id" = ` + a.Add(id) }, false); err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

/* ── supply items ────────────────────────────────────────────────────── */

/* GET /api/purchasing/supply-items */
func (h *handler) listSupplyItems(w http.ResponseWriter, r *http.Request) error {
	_, scope, err := h.staffScope(r, h.itemsStaff)
	if err != nil {
		return err
	}
	sp := r.URL.Query()
	page, limit := kit.IntParam(sp, "page", "1"), kit.IntParam(sp, "limit", "20")
	a := &kit.Args{}
	where := []string{`"deleted_at" IS NULL`}
	if s := sp.Get("is_active"); s == "true" || s == "false" {
		where = append(where, `"is_active" = `+a.Add(s == "true"))
	}
	if s := sp.Get("stockable"); s == "true" || s == "false" {
		where = append(where, `"stockable" = `+a.Add(s == "true"))
	}
	where = kit.ScopeFilters(scope, "", a, where)
	if s := sp.Get("search"); s != "" {
		where = append(where, kit.Search(a, "", s, "kode", "nama"))
	}
	rows, total, err := h.pageList(r.Context(), "supply_items", where, a, `"nama" ASC`, page, limit)
	if err != nil {
		return err
	}
	return kit.OK(w, struct {
		Success    bool           `json:"success"`
		Data       kit.Rows       `json:"data"`
		Pagination listPagination `json:"pagination"`
	}{true, rows, pagination(page, limit, total, math.Ceil(float64(total)/limit))})
}

// optionalText is `value?.trim() || null`.
func optionalText(v *string) any {
	if v == nil {
		return nil
	}
	if t := validate.JSTrim(*v); t != "" {
		return t
	}
	return nil
}

/* POST /api/purchasing/supply-items */
func (h *handler) createSupplyItem(w http.ResponseWriter, r *http.Request) error {
	u, scope, err := h.staffScope(r, h.itemsStaff)
	if err != nil {
		return err
	}
	f := validate.New(validate.ReadBody(r))
	kodeIn := f.Str("kode", validate.Rule{Optional: true}, validate.StrOpts{Max: 30})
	nama := f.Str("nama", validate.Rule{}, validate.StrOpts{Check: minLen(1, "Nama barang wajib diisi"), Max: 100})
	desc := f.Str("deskripsi", validate.Rule{Optional: true, Nullable: true}, validate.StrOpts{})
	kategori := f.Str("kategori", validate.Rule{Optional: true, Nullable: true}, validate.StrOpts{})
	satuan := f.UUID("satuan_id", validate.Rule{Optional: true, Nullable: true})
	stockable := f.BoolDefault("stockable", false)
	harga := f.Num("harga_beli", validate.Rule{HasDefault: true}, validate.NumOpts{Min: validate.Bound(0)})
	stokMin := f.Num("stok_minimum", validate.Rule{Optional: true}, validate.NumOpts{Min: validate.Bound(0)})
	active := f.Bool("is_active", validate.Rule{Optional: true})
	if err := kit.FirstIssueErr(f); err != nil {
		return err
	}
	ctx := r.Context()
	companyID, branchID := ps.EffectiveCompanyID(scope), ps.EffectiveBranchID(scope)
	kode := strings.ToUpper(validate.JSTrim(kit.Deref(kodeIn)))
	a := &kit.Args{}
	if kode == "" {
		prefix := "SUP-" + h.env.Now().UTC().Format("20060102")
		last, err := kit.QueryOne(ctx, h.env.DB, `SELECT kode FROM supply_items WHERE kode LIKE `+a.Add(prefix+"-%")+
			` AND deleted_at IS NULL`+scopeEq(a, "company_id", companyID)+scopeEq(a, "branch_id", branchID)+
			` ORDER BY kode DESC LIMIT 1`, a.Values...)
		if err != nil {
			return err
		}
		lastCode := ""
		if last != nil {
			lastCode = last.Str("kode")
		}
		kode = domain.NextSequentialCode(prefix, lastCode, 3)
	} else {
		dup, err := kit.QueryOne(ctx, h.env.DB, `SELECT id FROM supply_items WHERE kode = `+a.Add(kode)+` AND deleted_at IS NULL`+
			scopeEq(a, "company_id", companyID)+scopeEq(a, "branch_id", branchID)+` LIMIT 1`, a.Values...)
		if err != nil {
			return err
		}
		if dup != nil {
			return httpx.BadRequest("Kode barang sudah digunakan")
		}
	}
	hargaBeli, stok, isActive := 0.0, 0.0, true
	if harga != nil {
		hargaBeli = *harga
	}
	if stokMin != nil {
		stok = *stokMin
	}
	if active != nil {
		isActive = *active
	}
	var satuanID any
	if satuan != nil && *satuan != "" {
		satuanID = *satuan
	}
	row, err := kit.InsertOne(ctx, h.env.DB, "supply_items", kit.Obj("kode", kode, "nama", validate.JSTrim(*nama),
		"deskripsi", optionalText(desc), "kategori", optionalText(kategori), "satuan_id", satuanID, "stockable", stockable,
		"harga_beli", hargaBeli, "stok_minimum", stok, "is_active", isActive, "company_id", companyID, "branch_id", branchID,
		"created_by", u.ID))
	if err != nil {
		return err
	}
	return httpx.JSON(w, http.StatusCreated, kit.Obj("success", true, "data", row))
}

// supplyItemInScope is getSupplyItemInScope (404 outside the scope).
func (h *handler) supplyItemInScope(ctx context.Context, scope *ps.Scope, id string) (*kit.Row, error) {
	row, err := kit.QueryOne(ctx, h.env.DB, `SELECT * FROM supply_items WHERE id = $1 AND deleted_at IS NULL LIMIT 1`, id)
	if err != nil {
		return nil, err
	}
	if row == nil || !ps.RowInScope(scope, row.StrPtr("company_id"), row.StrPtr("branch_id")) {
		return nil, httpx.NotFound("Barang tidak ditemukan")
	}
	return row, nil
}

/* GET /api/purchasing/supply-items/{id} */
func (h *handler) getSupplyItem(w http.ResponseWriter, r *http.Request) error {
	_, scope, err := h.staffScope(r, h.itemsStaff)
	if err != nil {
		return err
	}
	row, err := h.supplyItemInScope(r.Context(), scope, r.PathValue("id"))
	if err != nil {
		return err
	}
	return kit.Data(w, row)
}

/* PATCH /api/purchasing/supply-items/{id} — only the sent fields. */
func (h *handler) updateSupplyItem(w http.ResponseWriter, r *http.Request) error {
	u, scope, err := h.staffScope(r, h.itemsStaff)
	if err != nil {
		return err
	}
	ctx := r.Context()
	id := r.PathValue("id")
	if _, err := h.supplyItemInScope(ctx, scope, id); err != nil {
		return err
	}
	f := validate.New(validate.ReadBody(r))
	set := kit.Obj("updated_by", u.ID)
	if v := f.Str("nama", validate.Rule{Optional: true}, validate.StrOpts{Min: 1, Max: 100}); v != nil {
		set.Set("nama", validate.JSTrim(*v))
	}
	for _, k := range []string{"deskripsi", "kategori"} {
		v := f.Str(k, validate.Rule{Optional: true, Nullable: true}, validate.StrOpts{})
		if _, sent := f.Fields()[k]; sent {
			set.Set(k, optionalText(v))
		}
	}
	if v := f.UUID("satuan_id", validate.Rule{Optional: true, Nullable: true}); v != nil && *v != "" {
		set.Set("satuan_id", *v)
	} else if _, sent := f.Fields()["satuan_id"]; sent {
		set.Set("satuan_id", nil)
	}
	optionalBool(f, set, "stockable")
	optionalNum(f, set, "harga_beli", validate.Rule{Optional: true}, validate.NumOpts{Min: validate.Bound(0)})
	optionalNum(f, set, "stok_minimum", validate.Rule{Optional: true}, validate.NumOpts{Min: validate.Bound(0)})
	optionalBool(f, set, "is_active")
	if err := kit.FirstIssueErr(f); err != nil {
		return err
	}
	rows, err := kit.Update(ctx, h.env.DB, "supply_items", set, func(a *kit.Args) string { return `"id" = ` + a.Add(id) }, true)
	if err != nil {
		return err
	}
	if len(rows) == 0 {
		return errNoRows
	}
	return kit.Data(w, rows[0])
}

/* DELETE /api/purchasing/supply-items/{id} */
func (h *handler) deleteSupplyItem(w http.ResponseWriter, r *http.Request) error {
	u, scope, err := h.staffScope(r, h.itemsStaff)
	if err != nil {
		return err
	}
	ctx := r.Context()
	id := r.PathValue("id")
	if _, err := h.supplyItemInScope(ctx, scope, id); err != nil {
		return err
	}
	if _, err := kit.Update(ctx, h.env.DB, "supply_items", kit.Obj("deleted_at", h.env.Now(), "deleted_by", u.ID),
		func(a *kit.Args) string { return `"id" = ` + a.Add(id) }, false); err != nil {
		return err
	}
	return kit.OK(w, kit.Obj("success", true))
}
