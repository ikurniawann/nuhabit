package catalog

import (
	"context"
	"fmt"
	"net/http"
	"regexp"
	"strings"

	"nuhabit/backend/internal/modules/inventory/kit"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	ps "nuhabit/backend/internal/platform/scope"
	"nuhabit/backend/internal/platform/xlsx"
)

// Port of POST /api/purchasing/import/products: lib/purchasing/
// import-products.ts and product-spreadsheet.ts. Company and branch come
// from each row's stall; a code already used on that stall is updated.

// productColumns are PRODUCT_IMPORT_COLUMNS keys (export header row).
var productColumns = []string{
	"kode", "nama", "stall_code", "kategori", "satuan_kode", "deskripsi",
	"harga_jual", "harga_modal", "markup_persen", "production_output_type", "status",
}

var productHeader = xlsx.HeaderNormalizer(map[string]string{
	"code": "kode", "product_code": "kode", "kode_produk": "kode",
	"name": "nama", "product_name": "nama", "nama_produk": "nama",
	"category": "kategori", "category_code": "kategori",
	"unit": "satuan_kode", "unit_code": "satuan_kode", "satuan": "satuan_kode",
	"description": "deskripsi", "notes": "deskripsi",
	"selling_price": "harga_jual", "price": "harga_jual",
	"cost_price": "harga_modal", "cost": "harga_modal",
	"markup": "markup_persen", "markup_percent": "markup_persen",
	"output_type": "production_output_type", "production_type": "production_output_type",
	"stall": "stall_code", "stall_code": "stall_code", "warehouse": "stall_code", "warehouse_code": "stall_code",
})

var spaceRun = regexp.MustCompile(`\s+`)

// normalizeOutputType is normalizeOutputType: WIP or FINISHED_GOOD.
func normalizeOutputType(v string) string {
	switch spaceRun.ReplaceAllString(strings.ToUpper(jsTrim(v)), "_") {
	case "WIP", "WORK_IN_PROGRESS":
		return "WIP"
	}
	return "FINISHED_GOOD"
}

// productPayload is buildProductPayload.
func productPayload(data map[string]string, satuanID string) *kit.Row {
	var kategori *string
	if k := emptyToNull(data["kategori"]); k != nil {
		kategori = kit.Ptr(strings.ToUpper(*k))
	}
	return kit.Obj(
		"nama", jsTrim(data["nama"]),
		"kategori", kategori,
		"satuan_id", satuanID,
		"deskripsi", emptyToNull(data["deskripsi"]),
		"harga_jual", parseNumberCell(data["harga_jual"], 0),
		"harga_modal", parseNumberCell(data["harga_modal"], 0),
		"markup_persen", parseNumberCell(data["markup_persen"], 30),
		"production_output_type", normalizeOutputType(data["production_output_type"]),
		"is_active", parseActiveCell(data["status"]),
	)
}

type productImport struct {
	h            *handler
	userID       string
	scope        *ps.Scope
	branchFilter *string
	units        map[string]string
	warehouses   map[string]string
	categories   map[string]bool
}

// productRefs are the ids a valid row resolves to.
type productRefs struct {
	warehouse *kit.ProductWarehouse
	satuanID  string
}

// unitID is resolveUnitId: with a company only its own units, without one
// any unit, global first.
func (p *productImport) unitID(ctx context.Context, code, companyID string) (string, error) {
	normalized := strings.ToUpper(jsTrim(code))
	key := kit.FirstNonEmpty(companyID, "*") + ":" + normalized
	if id, ok := p.units[key]; ok {
		return id, nil
	}
	a := &kit.Args{}
	sql := `SELECT id::text FROM item.units WHERE deleted_at IS NULL AND upper(kode) = upper(` + a.Add(normalized) + `)`
	if companyID != "" {
		sql += ` AND company_id = ` + a.Add(companyID) + ` LIMIT 1`
	} else {
		sql += ` ORDER BY company_id NULLS LAST LIMIT 1`
	}
	row, err := kit.QueryOne(ctx, p.h.env.DB, sql, a.Values...)
	if err != nil {
		return "", err
	}
	if row != nil {
		p.units[key] = row.Str("id")
	} else {
		p.units[key] = ""
	}
	return p.units[key], nil
}

// validCategory is isValidCategory: a global category or the company's own.
func (p *productImport) validCategory(ctx context.Context, code, companyID string) (bool, error) {
	normalized := strings.ToUpper(jsTrim(code))
	key := kit.FirstNonEmpty(companyID, "*") + ":" + normalized
	if ok, cached := p.categories[key]; cached {
		return ok, nil
	}
	a := &kit.Args{}
	sql := `SELECT code FROM item.product_categories WHERE deleted_at IS NULL AND upper(code) = upper(` + a.Add(normalized) + `) AND `
	if companyID != "" {
		sql += `(company_id IS NULL OR company_id = ` + a.Add(companyID) + `)`
	} else {
		sql += `company_id IS NULL`
	}
	row, err := kit.QueryOne(ctx, p.h.env.DB, sql+` LIMIT 1`, a.Values...)
	if err != nil {
		return false, err
	}
	p.categories[key] = row != nil && row.Str("code") != ""
	return p.categories[key], nil
}

// resolve is resolveRow: the row's stall, scope and unit, or the message
// the row is skipped with.
func (p *productImport) resolve(ctx context.Context, data map[string]string) (*productRefs, string, error) {
	if jsTrim(data["nama"]) == "" {
		return nil, "Required field missing: nama", nil
	}
	stallCode := jsTrim(data["stall_code"])
	if stallCode == "" {
		return nil, "Required field missing: stall_code", nil
	}
	warehouseID, err := p.h.warehouseByCode(ctx, stallCode, p.branchFilter, p.warehouses)
	if err != nil || warehouseID == "" {
		return nil, "Stall code not found: " + stallCode, err
	}
	wh, msg, err := kit.ValidateProductWarehouse(ctx, p.h.env.DB, warehouseID, p.scope)
	if err != nil || msg != "" {
		return nil, msg, err
	}
	satuanKode := jsTrim(data["satuan_kode"])
	if satuanKode == "" {
		return nil, "Required field missing: satuan_kode", nil
	}
	satuanID, err := p.unitID(ctx, satuanKode, wh.CompanyID)
	if err != nil || satuanID == "" {
		return nil, "Unit code not found: " + satuanKode, err
	}
	if kategori := jsTrim(data["kategori"]); kategori != "" {
		ok, err := p.validCategory(ctx, kategori, wh.CompanyID)
		if err != nil || !ok {
			return nil, "Category code not found: " + kategori, err
		}
	}
	return &productRefs{warehouse: wh, satuanID: satuanID}, "", nil
}

// nextCode is generateProductCode: PRD-YYYYMMDD-### (UTC date) on this
// stall and company/branch.
func (p *productImport) nextCode(ctx context.Context, wh *kit.ProductWarehouse) (string, error) {
	date := p.h.env.Now().UTC().Format("20060102")
	a := &kit.Args{}
	row, err := kit.QueryOne(ctx, p.h.env.DB, `SELECT kode FROM products WHERE kode LIKE `+a.Add("PRD-"+date+"-%")+
		` AND warehouse_id = `+a.Add(wh.WarehouseID)+` AND deleted_at IS NULL AND `+exactScope(a, &wh.CompanyID, &wh.BranchID)+
		` ORDER BY kode DESC LIMIT 1`, a.Values...)
	if err != nil {
		return "", err
	}
	last := ""
	if row != nil {
		last = row.Str("kode")
	}
	return fmt.Sprintf("PRD-%s-%03d", date, nextCodeSequence(last)), nil
}

/* POST /api/purchasing/import/products: form-data `file` (CSV/XLSX) */
func (h *handler) importProducts(w http.ResponseWriter, r *http.Request) error {
	user, scope, err := h.staffScope(r, h.itemsStaff)
	if err != nil {
		return err
	}
	_, branchFilter := ps.ImportBusinessIDs(scope)
	rows, err := readUploadedSheet(r, productHeader)
	if err != nil {
		return err
	}
	ctx := r.Context()
	p := &productImport{h: h, userID: user.ID, scope: scope, branchFilter: kit.OrNil(branchFilter),
		units: map[string]string{}, warehouses: map[string]string{}, categories: map[string]bool{}}
	sum := newImportSummary()
	for _, row := range rows {
		if xlsx.IsBlankRow(row.Data, productColumns...) {
			continue
		}
		refs, msg, err := p.resolve(ctx, row.Data)
		if err != nil {
			return err
		}
		if msg != "" {
			sum.skip(row.RowNumber, msg)
			continue
		}
		wh := refs.warehouse
		kode := jsTrim(row.Data["kode"])
		if kode == "" {
			if kode, err = p.nextCode(ctx, wh); err != nil {
				return err
			}
		}
		a := &kit.Args{}
		existing, err := kit.QueryOne(ctx, h.env.DB, `SELECT id::text FROM products WHERE kode = `+a.Add(kode)+
			` AND warehouse_id = `+a.Add(wh.WarehouseID)+` AND deleted_at IS NULL AND `+exactScope(a, &wh.CompanyID, &wh.BranchID)+` LIMIT 1`, a.Values...)
		if err != nil {
			return err
		}
		payload := productPayload(row.Data, refs.satuanID)
		failed, err := h.importRow(ctx, func(q database.Querier) error {
			var err error
			if existing != nil {
				payload.Set("warehouse_id", wh.WarehouseID).Set("company_id", wh.CompanyID).Set("branch_id", wh.BranchID).
					Set("updated_by", p.userID).Set("updated_at", h.env.Now())
				_, err = kit.Update(ctx, q, "products", payload, func(a *kit.Args) string { return `"id" = ` + a.Add(existing.Str("id")) }, false)
			} else {
				insert := kit.Obj("kode", kode, "company_id", wh.CompanyID, "branch_id", wh.BranchID, "warehouse_id", wh.WarehouseID)
				for _, k := range payload.Keys() {
					insert.Set(k, payload.Get(k))
				}
				_, err = kit.Insert(ctx, q, "products", []*kit.Row{insert.Set("created_by", p.userID)}, "", false)
			}
			if err != nil {
				return dbFailure(err)
			}
			return nil
		})
		switch {
		case err != nil:
			return err
		case failed != "":
			sum.skip(row.RowNumber, failed)
		case existing != nil:
			sum.Updated++
		default:
			sum.Imported++
		}
	}
	return httpx.JSON(w, http.StatusOK, sum)
}

/* GET /api/purchasing/export/products: .xlsx with the product import columns */
func (h *handler) exportProducts(w http.ResponseWriter, r *http.Request) error {
	_, scope, err := h.staffScope(r, h.itemsStaff)
	if err != nil {
		return err
	}
	a := &kit.Args{}
	where := kit.ScopeFilters(scope, "p.", a, []string{"p.deleted_at IS NULL"})
	return h.exportSheet(w, r, "Products", "products", productColumns, `SELECT
		p.kode::text, p.nama::text, wh.code::text, p.kategori::text, u.kode::text, p.deskripsi::text,
		COALESCE(p.harga_jual, 0)::text, COALESCE(p.harga_modal, 0)::text, COALESCE(p.markup_persen, 30)::text,
		COALESCE(p.production_output_type, 'FINISHED_GOOD')::text,
		CASE WHEN COALESCE(p.is_active, true) THEN 'active' ELSE 'inactive' END
		FROM item.products p
		LEFT JOIN item.units u ON u.id = p.satuan_id
		LEFT JOIN configuration.warehouses wh ON wh.id = p.warehouse_id
		WHERE `+strings.Join(where, " AND ")+`
		ORDER BY wh.code ASC, p.nama ASC`, a.Values...)
}
