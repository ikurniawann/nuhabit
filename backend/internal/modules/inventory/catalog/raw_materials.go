package catalog

import (
	"context"
	"errors"
	"math"
	"net/http"
	"strings"
	"time"

	"nuhabit/backend/internal/modules/inventory/domain"
	"nuhabit/backend/internal/modules/inventory/kit"
	"nuhabit/backend/internal/modules/inventory/ledger"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	ps "nuhabit/backend/internal/platform/scope"
	"nuhabit/backend/internal/platform/validate"
)

// lib/purchasing/raw-material-api.ts, raw-material-api-rules.ts,
// raw-material-coa.ts and purchase-price.ts.

const materialNotFound = "Bahan baku tidak ditemukan"

// errNoRows is a `.single()` miss the TS rethrows as a plain error (500).
var errNoRows = errors.New("No rows found")

var conversionSelect = `SELECT *, ` + kit.EmbedSQL("satuan", `"item"."units"`, "id", "raw_material_unit_conversions", "satuan_id") +
	` FROM "raw_material_unit_conversions"`

/* GET /api/purchasing/raw-materials — list + KPI summary (summary ignores below_minimum). */
func (h *handler) listRawMaterials(w http.ResponseWriter, r *http.Request) error {
	u, scope, err := h.staffScope(r, h.catalogStaff)
	if err != nil {
		return err
	}
	ctx := r.Context()
	src, err := kit.RawMaterialStockSource(ctx, h.env.DB, r, u.ID)
	if err != nil {
		return err
	}
	sp := r.URL.Query()
	page, limit := kit.IntParam(sp, "page", "1"), kit.IntParam(sp, "limit", "20")
	sortBy := sp.Get("sort_by")
	if sortBy == "" {
		sortBy = "nama"
	}
	dir := "ASC"
	if strings.ToUpper(sp.Get("sort_dir")) == "DESC" {
		dir = "DESC"
	}
	filters := func(a *kit.Args, belowMinimum bool) string {
		where := []string{`"deleted_at" IS NULL`}
		if src.WarehouseID != "" {
			where = append(where, `"warehouse_id" = `+a.Add(src.WarehouseID))
		}
		if c := ps.CompanyFilter(scope); c != nil {
			where = append(where, `("company_id" = `+a.Add(*c)+`)`)
		}
		if b := ps.BranchFilter(scope); b != nil {
			where = append(where, `("branch_id" = `+a.Add(*b)+`)`)
		}
		if s := sp.Get("search"); s != "" {
			where = append(where, kit.Search(a, "", s, "nama", "kode"))
		}
		if k := sp.Get("kategori"); k != "" {
			where = append(where, `"kategori" = `+a.Add(k))
		}
		if b := sp.Get("satuan_besar_id"); b != "" {
			where = append(where, `"satuan_besar_id" = `+a.Add(b))
		}
		if sp.Has("is_active") {
			where = append(where, `"is_active" = `+a.Add(sp.Get("is_active") == "true"))
		}
		if belowMinimum && sp.Get("below_minimum") == "true" {
			where = append(where, kit.Or(a, "", "status_stok.eq.MENIPIS,status_stok.eq.HABIS"))
		}
		return strings.Join(where, " AND ")
	}
	sa := &kit.Args{}
	statusRows, err := kit.Query(ctx, h.env.DB, `SELECT "status_stok" FROM `+src.View+` WHERE `+filters(sa, false), sa.Values...)
	if err != nil {
		return err
	}
	a := &kit.Args{}
	rows, total, err := h.pageList(ctx, src.View, []string{filters(a, true)}, a, `"`+strings.ReplaceAll(sortBy, `"`, `""`)+`" `+dir, page, limit)
	if err != nil {
		return err
	}
	if len(rows) > 0 {
		ids := make([]string, len(rows))
		for i, m := range rows {
			ids[i] = m.Str("id")
		}
		convs, err := kit.Query(ctx, h.env.DB, conversionSelect+` WHERE "raw_material_id" = ANY($1::uuid[]) AND "is_active" = $2
			ORDER BY "is_base" DESC, "qty_in_base_unit" ASC`, ids, true)
		if err != nil {
			return err
		}
		byMaterial := map[string][]*kit.Row{}
		for _, c := range convs {
			byMaterial[c.Str("raw_material_id")] = append(byMaterial[c.Str("raw_material_id")], c)
		}
		for _, m := range rows {
			list := byMaterial[m.Str("id")]
			if list == nil {
				list = []*kit.Row{}
			}
			m.Set("unit_conversions", list)
		}
	}
	statuses := make([]string, len(statusRows))
	for i, s := range statusRows {
		statuses[i] = s.Str("status_stok")
	}
	return kit.OK(w, struct {
		Data       kit.Rows                  `json:"data"`
		Pagination listPagination            `json:"pagination"`
		Summary    domain.StockStatusSummary `json:"summary"`
	}{rows, pagination(page, limit, total, math.Ceil(float64(total)/limit)), domain.SummarizeStockStatus(statuses)})
}

func (h *handler) activeConversions(ctx context.Context, id string) (kit.Rows, error) {
	return kit.Query(ctx, h.env.DB, conversionSelect+` WHERE "raw_material_id" = $1 AND "is_active" = $2
		ORDER BY "is_base" DESC, "qty_in_base_unit" ASC`, id, true)
}

/* GET /api/purchasing/raw-materials/{id} — detail, last 10 movements, BOM users, packs. */
func (h *handler) getRawMaterial(w http.ResponseWriter, r *http.Request) error {
	u, scope, err := h.staffScope(r, h.itemsStaff)
	if err != nil {
		return err
	}
	ctx := r.Context()
	src, err := kit.RawMaterialStockSource(ctx, h.env.DB, r, u.ID)
	if err != nil {
		return err
	}
	id := r.PathValue("id")
	a := &kit.Args{}
	sql := `SELECT * FROM ` + src.View + ` WHERE "id" = ` + a.Add(id)
	if src.WarehouseID != "" {
		sql += ` AND "warehouse_id" = ` + a.Add(src.WarehouseID)
	}
	material, err := kit.QueryOne(ctx, h.env.DB, sql, a.Values...)
	if err != nil {
		return err
	}
	if material == nil || !ps.RowInScope(scope, material.StrPtr("company_id"), material.StrPtr("branch_id")) {
		return httpx.NotFound(materialNotFound)
	}
	movements, err := kit.Query(ctx, h.env.DB, `SELECT * FROM "inventory_movements" WHERE "raw_material_id" = $1
		ORDER BY "created_at" DESC LIMIT $2`, id, 10)
	if err != nil {
		return err
	}
	products, err := kit.Query(ctx, h.env.DB, `SELECT *, `+kit.EmbedSQL("product", `"item"."products"`, "id", "bom_items", "product_id")+`
		FROM "bom_items" WHERE "raw_material_id" = $1 AND "is_active" = $2`, id, true)
	if err != nil {
		return err
	}
	convs, err := h.activeConversions(ctx, id)
	if err != nil {
		return err
	}
	return kit.Data(w, material.Set("movements", movements).Set("products", products).Set("unit_conversions", convs))
}

/* ── body parsing (rawMaterialCreateSchema / rawMaterialUpdateSchema) ──── */

// prepareMaterialBody maps kode_bahan/nama_bahan and turns "" into null on
// the optional text fields; a non-object body becomes {}.
func prepareMaterialBody(r *http.Request) map[string]any {
	raw, _ := validate.ReadBody(r)
	obj, ok := raw.(map[string]any)
	if !ok {
		return map[string]any{}
	}
	if obj["kode"] == nil {
		if s, ok := obj["kode_bahan"].(string); ok {
			obj["kode"] = s
		}
	}
	if obj["nama"] == nil {
		if s, ok := obj["nama_bahan"].(string); ok {
			obj["nama"] = s
		}
	}
	for _, k := range []string{"kode", "deskripsi", "satuan_kecil_id", "storage_condition", "coa_production", "coa_rnd", "coa_asset"} {
		if obj[k] == "" {
			obj[k] = nil
		}
	}
	return obj
}

// coaCode is the coaAccountCode zod pipe: absent stays absent, null or ""
// is null, else a 7-digit code or a custom issue.
func coaCode(f *validate.Form, row *kit.Row, key string) {
	v, sent := f.Fields()[key]
	if !sent {
		return
	}
	if v == nil {
		row.Set(key, nil)
		return
	}
	s, ok := f.CheckString(key, v, validate.StrOpts{Max: 20})
	if !ok {
		return
	}
	if s == "" {
		row.Set(key, nil)
		return
	}
	code := domain.NormalizeCoaAccountCode(s)
	if code == "" {
		f.Fail(key, "custom", "Kode Chart of Accounts tidak valid (gunakan 7 digit, mis. 1301001)")
		return
	}
	row.Set(key, code)
}

func numDefault(f *validate.Form, row *kit.Row, key string, def float64) {
	if v := f.Num(key, validate.Rule{HasDefault: true}, validate.NumOpts{Min: validate.Bound(0)}); v != nil {
		row.Set(key, *v)
	} else if _, sent := f.Fields()[key]; !sent {
		row.Set(key, def)
	}
}

// pack is one unit_conversions item.
type pack = domain.PlannedConversion

func parsePacks(f *validate.Form, update bool) ([]pack, bool) {
	var packs []pack
	items := f.List("unit_conversions", validate.Rule{Optional: true}, math.MaxInt32, func(sub *validate.Form, i int, v any) {
		item := sub.Item(i, v)
		var p pack
		if id := item.UUID("satuan_id", validate.Rule{}); id != nil {
			p.SatuanID = *id
		}
		if q := kit.NumCheck(item, "qty_in_base_unit", validate.Rule{}, kit.Min(0.000001, "Too small: expected number to be >=0.000001")); q != nil {
			p.QtyInBaseUnit = *q
		}
		if b := item.Bool("is_base", validate.Rule{Optional: true}); b != nil {
			p.IsBase = *b
		}
		if update {
			p.IsPurchaseDefault = item.Bool("is_purchase_default", validate.Rule{Optional: true})
			p.IsIssueDefault = item.Bool("is_issue_default", validate.Rule{Optional: true})
			if raw, sent := item.Fields()["barcode"]; sent && item.Fields() != nil {
				p.HasBarcode = true
				if raw != nil {
					if s, ok := item.CheckString("barcode", raw, validate.StrOpts{Trim: true, Max: 64}); ok {
						p.Barcode = &s
					}
				}
			}
		}
		packs = append(packs, p)
	})
	return packs, items != nil
}

// parseMaterial validates the create (or update) schema into the column
// payload (zod output keys, in schema order) and the packs.
func parseMaterial(r *http.Request, create bool) (*kit.Row, []pack, bool, error) {
	f := validate.New(prepareMaterialBody(r), true)
	cols := kit.NewRow()
	if create {
		optionalStr(f, cols, "kode", validate.Rule{Optional: true, Nullable: true}, validate.StrOpts{Max: 20})
		if v := f.Str("nama", validate.Rule{}, validate.StrOpts{Check: minLen(1, "Material name is required"), Max: 100}); v != nil {
			cols.Set("nama", *v)
		}
		if v := f.Str("kategori", validate.Rule{}, validate.StrOpts{Check: minLen(1, "Category is required"), Max: 30}); v != nil {
			cols.Set("kategori", *v)
		}
		optionalStr(f, cols, "deskripsi", validate.Rule{Optional: true, Nullable: true}, validate.StrOpts{})
		if v := f.Str("satuan_besar_id", validate.Rule{}, validate.StrOpts{Check: func(s string) (string, string, bool) {
			return "invalid_format", "Large unit is required", validate.IsUUID(s)
		}}); v != nil {
			cols.Set("satuan_besar_id", *v)
		}
		optionalStr(f, cols, "satuan_kecil_id", validate.Rule{Optional: true, Nullable: true}, validate.StrOpts{Check: validate.UUIDCheck})
		numDefault(f, cols, "harga_beli", 0)
		numDefault(f, cols, "konversi_factor", 1)
		numDefault(f, cols, "stok_minimum", 0)
		numDefault(f, cols, "stok_maximum", 0)
	} else {
		optionalStr(f, cols, "nama", validate.Rule{Optional: true}, validate.StrOpts{Min: 1, Max: 100})
		optionalStr(f, cols, "kategori", validate.Rule{Optional: true}, validate.StrOpts{Min: 1, Max: 30})
		optionalStr(f, cols, "deskripsi", validate.Rule{Optional: true}, validate.StrOpts{})
		optionalStr(f, cols, "satuan_besar_id", validate.Rule{Optional: true, Nullable: true}, validate.StrOpts{Check: validate.UUIDCheck})
		optionalStr(f, cols, "satuan_kecil_id", validate.Rule{Optional: true, Nullable: true}, validate.StrOpts{Check: validate.UUIDCheck})
		for _, k := range []string{"harga_beli", "konversi_factor", "stok_minimum", "stok_maximum"} {
			optionalNum(f, cols, k, validate.Rule{Optional: true}, validate.NumOpts{Min: validate.Bound(0)})
		}
	}
	optionalNum(f, cols, "shelf_life_days", validate.Rule{Optional: true, Nullable: true}, validate.NumOpts{Min: validate.Bound(0)})
	optionalStr(f, cols, "storage_condition", validate.Rule{Optional: true, Nullable: true}, validate.StrOpts{Max: 20})
	if !create {
		optionalBool(f, cols, "is_active")
	}
	if _, sent := f.Fields()["coa"]; sent {
		if v := kit.Enum(f, "coa", validate.Rule{Optional: true, Nullable: true}, []string{"PRODUCTION", "RND", "ASSET"}, ""); v != nil {
			cols.Set("coa", *v)
		} else if f.Fields()["coa"] == nil {
			cols.Set("coa", nil)
		}
	}
	coaCode(f, cols, "coa_production")
	coaCode(f, cols, "coa_rnd")
	coaCode(f, cols, "coa_asset")
	packs, sent := parsePacks(f, !create)
	if err := kit.FirstIssueErr(f); err != nil {
		return nil, nil, false, err
	}
	return cols, packs, sent, nil
}

func strOrNil(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func coaStr(row *kit.Row, key string) string {
	s, _ := row.Get(key).(string)
	return s
}

/* POST /api/purchasing/raw-materials */
func (h *handler) createRawMaterial(w http.ResponseWriter, r *http.Request) error {
	_, scope, err := h.staffScope(r, h.itemsStaff)
	if err != nil {
		return err
	}
	cols, packs, _, err := parseMaterial(r, true)
	if err != nil {
		return err
	}
	ctx := r.Context()
	db := h.env.DB
	companyID, branchID := ps.EffectiveCompanyID(scope), ps.EffectiveBranchID(scope)
	kode := cols.Str("kode")
	if kode == "" {
		prefix := "BHN-" + h.env.Now().UTC().Format("2006")
		last, err := kit.QueryOne(ctx, db, `SELECT kode FROM raw_materials WHERE kode ILIKE $1 AND deleted_at IS NULL
			ORDER BY kode DESC LIMIT 1`, prefix+"-%")
		if err != nil {
			return err
		}
		lastCode := ""
		if last != nil {
			lastCode = last.Str("kode")
		}
		kode = domain.NextSequentialCode(prefix, lastCode, 4)
	}
	a := &kit.Args{}
	dupSQL := `SELECT id FROM raw_materials WHERE kode = ` + a.Add(kode) + ` AND deleted_at IS NULL` +
		scopeEq(a, "company_id", companyID) + scopeEq(a, "branch_id", branchID)
	if dup, err := kit.QueryOne(ctx, db, dupSQL+` LIMIT 1`, a.Values...); err != nil {
		return err
	} else if dup != nil {
		return httpx.BadRequest("Material code is already in use")
	}

	asset, production := domain.DefaultCoa(cols.Str("kategori"))
	coaProduction := kit.FirstNonEmpty(coaStr(cols, "coa_production"), production)
	coaRnd := coaStr(cols, "coa_rnd")
	coaAsset := kit.FirstNonEmpty(coaStr(cols, "coa_asset"), asset)
	coa := coaStr(cols, "coa")
	if coa == "" {
		coa = domain.LegacyCoaEnum(coaProduction, coaRnd, coaAsset)
	}
	cols.Set("kode", kode).Set("coa", strOrNil(coa)).Set("coa_production", strOrNil(coaProduction)).
		Set("coa_rnd", strOrNil(coaRnd)).Set("coa_asset", strOrNil(coaAsset)).
		Set("company_id", companyID).Set("branch_id", branchID).Set("is_active", true)

	var material *kit.Row
	err = h.env.Tx(ctx, func(q database.Querier) error {
		if material, err = kit.InsertOne(ctx, q, "raw_materials", cols); err != nil {
			return err
		}
		planned := domain.PlanUnitConversions(material.StrPtr("satuan_besar_id"), material.StrPtr("satuan_kecil_id"), material.Get("konversi_factor"), packs)
		rows := make([]*kit.Row, len(planned))
		for i, p := range planned {
			rows[i] = kit.Obj("raw_material_id", material.Get("id"), "satuan_id", p.SatuanID, "qty_in_base_unit", p.QtyInBaseUnit,
				"is_base", p.IsBase, "is_active", true)
		}
		_, err := kit.Insert(ctx, q, "raw_material_unit_conversions", rows, "raw_material_id,satuan_id", false)
		return err
	})
	if err != nil {
		return err
	}
	return httpx.JSON(w, http.StatusCreated, kit.Obj("success", true, "data", material, "message", "Raw material added successfully"))
}

// scopeEq is `.eq(col, id)` or `.is(col, null)`.
func scopeEq(a *kit.Args, col string, id *string) string {
	if id != nil {
		return ` AND ` + col + ` = ` + a.Add(*id)
	}
	return ` AND ` + col + ` IS NULL`
}

func (h *handler) activeMaterial(ctx context.Context, id string) (*kit.Row, error) {
	row, err := kit.QueryOne(ctx, h.env.DB, `SELECT * FROM raw_materials WHERE id = $1 AND deleted_at IS NULL`, id)
	if err != nil || row == nil {
		return nil, httpx.NotFound(materialNotFound)
	}
	return row, nil
}

/*
PUT|PATCH /api/purchasing/raw-materials/{id} — master fields, and when

	unit_conversions is sent the active pack set (missing packs deactivated).
*/
func (h *handler) updateRawMaterial(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.itemsStaff(r); err != nil {
		return err
	}
	set, packs, packsSent, err := parseMaterial(r, false)
	if err != nil {
		return err
	}
	ctx := r.Context()
	id := r.PathValue("id")
	existing, err := h.activeMaterial(ctx, id)
	if err != nil {
		return err
	}
	var flags []string
	if packsSent {
		if flags, err = domain.PackDefaultFlagsToReset(packs); err != nil {
			return httpx.BadRequest(err.Error())
		}
	}
	if !set.Has("coa") {
		pick := func(key string) string {
			if set.Has(key) {
				return coaStr(set, key)
			}
			return existing.Str(key)
		}
		coa := domain.LegacyCoaEnum(pick("coa_production"), pick("coa_rnd"), pick("coa_asset"))
		if coa != "" {
			set.Set("coa", coa)
		} else {
			set.Set("coa", existing.Get("coa"))
		}
	}
	now := h.env.Now()
	set.Set("updated_at", now)
	var material *kit.Row
	err = h.env.Tx(ctx, func(q database.Querier) error {
		rows, err := kit.Update(ctx, q, "raw_materials", set, func(a *kit.Args) string {
			return `"id" = ` + a.Add(id) + ` AND "deleted_at" IS NULL`
		}, true)
		if err != nil {
			return err
		}
		if len(rows) == 0 {
			return errNoRows
		}
		material = rows[0]
		if !packsSent {
			return nil
		}
		planned := domain.PlanUnitConversions(material.StrPtr("satuan_besar_id"), material.StrPtr("satuan_kecil_id"), material.Get("konversi_factor"), packs)
		for _, key := range flags {
			if _, err := q.Exec(ctx, `UPDATE raw_material_unit_conversions SET "`+key+`" = false WHERE raw_material_id = $1`, id); err != nil {
				return err
			}
		}
		current, err := kit.Query(ctx, q, `SELECT id::text AS id, satuan_id::text AS satuan_id, is_purchase_default, is_issue_default
			FROM raw_material_unit_conversions WHERE raw_material_id = $1`, id)
		if err != nil {
			return err
		}
		stored := map[string]*kit.Row{}
		for _, c := range current {
			stored[c.Str("satuan_id")] = c
		}
		next := map[string]bool{}
		for _, p := range planned {
			next[p.SatuanID] = true
		}
		var inactive []string
		for _, c := range current {
			if !next[c.Str("satuan_id")] {
				inactive = append(inactive, c.Str("id"))
			}
		}
		if len(inactive) > 0 {
			if _, err := q.Exec(ctx, `UPDATE raw_material_unit_conversions SET is_active = false, updated_at = $1 WHERE id = ANY($2::uuid[])`,
				now, inactive); err != nil {
				return err
			}
		}
		if len(planned) == 0 {
			return nil
		}
		// The packs go in one multi-row upsert, so a flag one pack sends is
		// a column for all: the others keep their stored flag (false when new).
		flag := func(sent *bool, satuanID, key string) bool {
			if sent != nil {
				return *sent
			}
			if c, ok := stored[satuanID]; ok {
				return c.Bool(key)
			}
			return false
		}
		rows = make(kit.Rows, len(planned))
		for i, p := range planned {
			row := kit.Obj("raw_material_id", id, "satuan_id", p.SatuanID, "qty_in_base_unit", p.QtyInBaseUnit, "is_base", p.IsBase, "is_active", true,
				"is_purchase_default", flag(p.IsPurchaseDefault, p.SatuanID, "is_purchase_default"),
				"is_issue_default", flag(p.IsIssueDefault, p.SatuanID, "is_issue_default"))
			if p.HasBarcode {
				var b any
				if p.Barcode != nil && *p.Barcode != "" {
					b = *p.Barcode
				}
				row.Set("barcode", b)
			}
			rows[i] = row.Set("updated_at", now)
		}
		_, err = kit.Insert(ctx, q, "raw_material_unit_conversions", rows, "raw_material_id,satuan_id", false)
		return err
	})
	if err != nil {
		return err
	}
	return kit.OK(w, kit.Obj("success", true, "data", material, "message", "Bahan baku berhasil diupdate"))
}

/*
DELETE /api/purchasing/raw-materials/{id} — refused while stock is on hand

	(summed over its active inventory rows) or a product BOM uses it.
*/
func (h *handler) deleteRawMaterial(w http.ResponseWriter, r *http.Request) error {
	u, err := h.itemsStaff(r)
	if err != nil {
		return err
	}
	ctx := r.Context()
	id := r.PathValue("id")
	material, err := h.activeMaterial(ctx, id)
	if err != nil {
		return err
	}
	stock, err := kit.QueryOne(ctx, h.env.DB, `SELECT COALESCE(SUM(qty_available), 0)::float8 AS qty,
		(SELECT nama FROM units WHERE id = $2) AS unit
		FROM inventory WHERE raw_material_id = $1 AND is_active = true`, id, material.Get("satuan_besar_id"))
	if err != nil {
		return err
	}
	if qty := stock.Num("qty"); qty > 0 {
		return httpx.BadRequest("Bahan baku tidak bisa dihapus karena masih ada stok " + kit.JSNum(qty) + " " + kit.FirstNonEmpty(stock.Str("unit"), "unit"))
	}
	used, err := kit.QueryOne(ctx, h.env.DB, `SELECT id FROM bom_items WHERE raw_material_id = $1 AND is_active = true LIMIT 1`, id)
	if err == nil && used != nil {
		return httpx.BadRequest("Bahan baku tidak bisa dihapus karena masih digunakan di BOM produk")
	}
	now := h.env.Now()
	if _, err := kit.Update(ctx, h.env.DB, "raw_materials", kit.Obj("is_active", false, "deleted_at", now, "deleted_by", u.ID, "updated_at", now),
		func(a *kit.Args) string { return `"id" = ` + a.Add(id) + ` AND "deleted_at" IS NULL` }, false); err != nil {
		return err
	}
	return kit.OK(w, kit.Obj("success", true, "message", "Bahan baku berhasil dihapus"))
}

// materialInScope is findMaterialInScope (404 when missing or outside scope).
func (h *handler) materialInScope(ctx context.Context, scope *ps.Scope, id, columns string) (*kit.Row, error) {
	row, err := kit.QueryOne(ctx, h.env.DB, `SELECT `+columns+` FROM raw_materials WHERE id = $1 AND deleted_at IS NULL`, id)
	if err != nil || row == nil || !ps.RowInScope(scope, row.StrPtr("company_id"), row.StrPtr("branch_id")) {
		return nil, httpx.NotFound(materialNotFound)
	}
	return row, nil
}

// monthsAgo is `d.setMonth(d.getMonth() - months)` on the server's (UTC) clock.
func monthsAgo(now time.Time, months int) time.Time { return now.UTC().AddDate(0, -months, 0) }

/* GET /api/purchasing/raw-materials/{id}/price-history?months=&limit= */
func (h *handler) priceHistory(w http.ResponseWriter, r *http.Request) error {
	_, scope, err := h.staffScope(r, h.itemsStaff)
	if err != nil {
		return err
	}
	sp := r.URL.Query()
	months := math.Max(1, kit.IntParam(sp, "months", "12"))
	limit := math.Min(200, math.Max(1, kit.IntParam(sp, "limit", "50")))
	ctx := r.Context()
	id := r.PathValue("id")
	material, err := h.materialInScope(ctx, scope, id, "id, kode, nama, company_id, branch_id, satuan_besar_id, satuan_kecil_id, konversi_factor, harga_beli")
	if err != nil {
		return err
	}
	if math.IsNaN(months) {
		return errors.New("Invalid time value") // new Date(NaN).toISOString() throws
	}
	start := monthsAgo(h.env.Now(), int(months))
	rows, err := kit.Query(ctx, h.env.DB, `SELECT id, tipe, jumlah, unit_cost, total_cost, reference_type, reference_id, reference_number, created_at
		FROM inventory_movements WHERE raw_material_id = $1 AND tipe = 'in' AND reference_type IN ('grn', 'import')
		AND created_at >= $2 ORDER BY created_at DESC LIMIT $3`, id, start.Format(httpx.JSTimeLayout), kit.N(limit))
	if err != nil {
		return err
	}
	costs := kit.Rows{}
	var values []float64
	for _, row := range rows {
		if c := row.Num("unit_cost"); c > 0 {
			costs = append(costs, row)
			values = append(values, c)
		}
	}
	harga := material.Num("harga_beli")
	konversi := 1.0
	if s := material.Str("konversi_factor"); s != "" {
		konversi = kit.ToNum(s)
	}
	return kit.Data(w, kit.Obj(
		"material", kit.Obj("id", material.Get("id"), "kode", material.Get("kode"), "nama", material.Get("nama"), "harga_beli", harga,
			"konversi_factor", konversi, "satuan_besar_id", material.Get("satuan_besar_id"), "satuan_kecil_id", material.Get("satuan_kecil_id")),
		"purchase_costs", costs,
		"summary", domain.SummarizePurchaseCosts(values, months),
	))
}

/* GET /api/purchasing/raw-materials/{id}/purchase-price?supplier_id=&satuan_id=&months= */
func (h *handler) purchasePrice(w http.ResponseWriter, r *http.Request) error {
	_, scope, err := h.staffScope(r, h.itemsStaff)
	if err != nil {
		return err
	}
	sp := r.URL.Query()
	months := 24.0
	if m := kit.IntParam(sp, "months", "24"); !math.IsNaN(m) {
		months = math.Max(1, m)
	}
	ctx := r.Context()
	id := r.PathValue("id")
	if _, err := h.materialInScope(ctx, scope, id, "id, company_id, branch_id"); err != nil {
		return err
	}
	var satuan *string
	if sp.Has("satuan_id") {
		s := sp.Get("satuan_id")
		satuan = &s
	}
	suggestion, err := h.purchasePriceSuggestion(ctx, id, satuan, sp.Get("supplier_id"), int(months))
	if err != nil {
		return err
	}
	return kit.Data(w, suggestion)
}

// purchasePriceSuggestion is getPurchasePriceSuggestions for one material:
// the newest receipt cost (preferring the supplier's GRNs), else the master
// price per base unit, scaled to the requested unit.
func (h *handler) purchasePriceSuggestion(ctx context.Context, id string, satuanID *string, supplierID string, months int) (*kit.Row, error) {
	db := h.env.DB
	start := monthsAgo(h.env.Now(), months)
	movements, err := kit.Query(ctx, db, `SELECT raw_material_id, unit_cost, reference_type, reference_id, reference_number, created_at
		FROM inventory_movements WHERE raw_material_id = ANY($1::uuid[]) AND tipe = 'in' AND reference_type IN ('grn', 'import')
		AND created_at >= $2 ORDER BY created_at DESC LIMIT 500`, []string{id}, start.Format(httpx.JSTimeLayout))
	if err != nil {
		return nil, err
	}
	var withCost kit.Rows
	var grnIDs []string
	for _, m := range movements {
		if m.Num("unit_cost") > 0 {
			withCost = append(withCost, m)
			if m.Str("reference_type") == "grn" && m.Str("reference_id") != "" {
				grnIDs = append(grnIDs, m.Str("reference_id"))
			}
		}
	}
	supplierGrns := map[string]bool{}
	if supplierID != "" && len(grnIDs) > 0 {
		if supplierGrns, err = h.ports.Procurement.SupplierGrnIDs(ctx, db, grnIDs, supplierID); err != nil {
			return nil, err
		}
	}
	var base *kit.Row
	source := ""
	for _, m := range withCost {
		from := m.Str("reference_type") == "grn" && supplierGrns[m.Str("reference_id")]
		if base != nil && (source == "supplier_grn" || !from) {
			continue
		}
		source = "any_grn"
		if from {
			source = "supplier_grn"
		}
		base = kit.Obj("cost", m.Num("unit_cost"), "reference_number", m.Get("reference_number"), "purchased_at", m.Get("created_at"))
	}
	resolve, err := ledger.NewBaseUnitResolver(ctx, db, []string{id})
	if err != nil {
		return nil, err
	}
	if base == nil {
		m, err := kit.QueryOne(ctx, db, `SELECT satuan_besar_id::text, satuan_kecil_id::text, konversi_factor, harga_beli FROM raw_materials WHERE id = $1`, id)
		if err != nil {
			return nil, err
		}
		if m != nil && m.Num("harga_beli") > 0 {
			// harga_beli is per satuan besar; the TS resolves it without packs.
			factor := domain.PackFactor(&domain.Material{SatuanBesarID: m.StrPtr("satuan_besar_id"),
				SatuanKecilID: m.StrPtr("satuan_kecil_id"), KonversiFactor: m.NumPtr("konversi_factor")}, nil, m.Str("satuan_besar_id"))
			cost := m.Num("harga_beli")
			if factor > 0 {
				cost /= factor
			}
			source = "master"
			base = kit.Obj("cost", cost, "reference_number", nil, "purchased_at", nil)
		}
	}
	cost := 0.0
	var src, ref, at any
	if base != nil {
		cost, src, ref, at = base.Num("cost"), source, base.Get("reference_number"), base.Get("purchased_at")
	}
	factor := resolve(id, satuanID)
	if !(factor > 0) {
		factor = 1
	}
	return kit.Obj("raw_material_id", id, "satuan_id", satuanID, "base_unit_cost", cost, "unit_price", cost*factor,
		"source", src, "reference_number", ref, "purchased_at", at), nil
}
