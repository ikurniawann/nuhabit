package catalog

import (
	"context"
	"fmt"
	"net/http"
	"strings"

	"nuhabit/backend/internal/modules/inventory/kit"
	"nuhabit/backend/internal/modules/inventory/ledger"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	ps "nuhabit/backend/internal/platform/scope"
	"nuhabit/backend/internal/platform/stall"
	"nuhabit/backend/internal/platform/xlsx"
)

// Port of POST /api/purchasing/import/raw-materials: lib/purchasing/
// import-raw-materials.ts and raw-material-spreadsheet.ts. A code already
// used in the caller's company/branch is updated and its stock set to the
// file's quantity; a new code is inserted with its opening stock.

// rawMaterialColumns are RAW_MATERIAL_IMPORT_COLUMNS keys (export header row).
var rawMaterialColumns = []string{
	"kode", "nama", "kategori", "satuan_besar_kode", "satuan_kecil_kode", "konversi_factor", "stok_minimum",
	"stok_maximum", "shelf_life_days", "coa", "harga_beli", "opening_stock", "stall_code", "deskripsi", "status",
}

var rawMaterialHeader = xlsx.HeaderNormalizer(map[string]string{
	"code": "kode", "name": "nama", "category": "kategori", "category_code": "kategori",
	"purchase_unit": "satuan_besar_kode", "satuan_pembelian": "satuan_besar_kode", "large_unit_code": "satuan_besar_kode",
	"usage_unit": "satuan_kecil_kode", "satuan_penggunaan": "satuan_kecil_kode", "small_unit_code": "satuan_kecil_kode",
	"conversion_factor": "konversi_factor", "qty_per_unit": "konversi_factor",
	"minimum_stock": "stok_minimum", "maximum_stock": "stok_maximum", "stok_maksimum": "stok_maximum",
	"shelf_life_(days)": "shelf_life_days", "shelf_life_days": "shelf_life_days", "masa_simpan": "shelf_life_days",
	"purchase_price": "harga_beli", "harga_rata_rata": "harga_beli",
	"description":   "deskripsi",
	"opening_stock": "opening_stock", "initial_stock": "opening_stock", "stok_awal": "opening_stock", "qty_onhand": "opening_stock",
	"stall_code": "stall_code", "warehouse_code": "stall_code", "warehouse_kode": "stall_code", "gudang_kode": "stall_code",
})

// rawMaterialFields is RawMaterialSheetFields.
type rawMaterialFields struct {
	nama, kategori                   string
	satuanBesarKode, satuanKecilKode string
	warehouseCode                    string
	coaRaw                           string
	coa                              *string
	konversiFactor, hargaBeli        float64
	hasStockValue                    bool
	stockQty                         float64
	deskripsi                        *string
	stokMinimum, stokMaximum         float64
	shelfLifeDays                    *float64
	isActive                         bool
}

// readRawMaterialRow is readRawMaterialRow.
func readRawMaterialRow(data map[string]string) rawMaterialFields {
	f := rawMaterialFields{
		nama:            jsTrim(data["nama"]),
		kategori:        jsTrim(data["kategori"]),
		satuanBesarKode: jsTrim(data["satuan_besar_kode"]),
		satuanKecilKode: jsTrim(data["satuan_kecil_kode"]),
		warehouseCode:   jsTrim(data["stall_code"]),
		coaRaw:          jsTrim(data["coa"]),
		konversiFactor:  parseNumberCell(data["konversi_factor"], 1),
		hargaBeli:       parseNumberCell(data["harga_beli"], 0),
		hasStockValue:   jsTrim(data["opening_stock"]) != "",
		stockQty:        parseNumberCell(data["opening_stock"], 0),
		deskripsi:       emptyToNull(data["deskripsi"]),
		stokMinimum:     parseNumberCell(data["stok_minimum"], 0),
		stokMaximum:     parseNumberCell(data["stok_maximum"], 0),
		shelfLifeDays:   parseOptionalIntCell(data["shelf_life_days"]),
		isActive:        parseActiveCell(data["status"]),
	}
	switch coa := strings.ToUpper(f.coaRaw); coa {
	case "PRODUCTION", "RND", "ASSET":
		f.coa = &coa
	}
	return f
}

// missing is missingRawMaterialFields.
func (f rawMaterialFields) missing() []string {
	var out []string
	if f.nama == "" {
		out = append(out, "nama")
	}
	if f.satuanBesarKode == "" {
		out = append(out, "satuan_besar_kode")
	}
	if f.kategori == "" {
		out = append(out, "kategori")
	}
	return out
}

// normalizeKategori is normalizeKategori: " bahan kering " → BAHAN_KERING.
func normalizeKategori(v string) string {
	return spaceRun.ReplaceAllString(strings.ToUpper(jsTrim(kit.FirstNonEmpty(v, "LAIN"))), "_")
}

// unitCostForStock is unitCostForStock: the purchase price per large unit
// becomes a cost per stock (small) unit.
func unitCostForStock(hargaBeli, konversiFactor float64, hasSmallUnit bool) float64 {
	if !hasSmallUnit || konversiFactor <= 0 {
		return hargaBeli
	}
	return hargaBeli / konversiFactor
}

// unitConversion is one raw_material_unit_conversions row.
type unitConversion struct {
	SatuanID      string
	QtyInBaseUnit float64
	IsBase        bool
}

// buildUnitConversions is buildUnitConversions: the small unit is the base
// (1), the large unit is worth konversi (the saved konversi_factor, nil
// counting as 1); one row per unit.
func buildUnitConversions(satuanBesarID string, satuanKecilID *string, konversi *float64) []unitConversion {
	var all []unitConversion
	big := unitConversion{SatuanID: satuanBesarID, QtyInBaseUnit: 1, IsBase: true}
	if satuanKecilID != nil {
		all = append(all, unitConversion{SatuanID: *satuanKecilID, QtyInBaseUnit: 1, IsBase: true})
		big.IsBase = false
		if konversi != nil {
			big.QtyInBaseUnit = *konversi
		}
	}
	all = append(all, big)
	var out []unitConversion
	seen := map[string]bool{}
	for _, c := range all {
		if !seen[c.SatuanID] {
			seen[c.SatuanID] = true
			out = append(out, c)
		}
	}
	return out
}

// rawMaterialMessages are the per-path texts: the update path has been in
// English from the start.
type rawMaterialMessages struct {
	largeUnit, smallUnit, coa string
}

var (
	updateMessages = rawMaterialMessages{
		largeUnit: `Large unit "%s" not found. Import units first.`,
		smallUnit: `Small unit "%s" not found`,
		coa:       "COA must be PRODUCTION, RND, or ASSET",
	}
	insertMessages = rawMaterialMessages{
		largeUnit: `Satuan besar "%s" tidak ditemukan. Import satuan terlebih dahulu.`,
		smallUnit: `Satuan kecil "%s" tidak ditemukan`,
		coa:       "COA harus PRODUCTION, RND, atau ASSET",
	}
)

type rawMaterialImport struct {
	h                   *handler
	userID              string
	companyID, branchID *string
	units, warehouses   map[string]string
	categories          map[string]bool
}

// rawMaterialRefs are resolveReferences' ids.
type rawMaterialRefs struct {
	satuanBesarID string
	satuanKecilID *string
	warehouseID   *string
}

// companyScoped appends "(company_id = $n OR company_id IS NULL)" when the
// import has a company: its own masters first, then global templates.
func (m *rawMaterialImport) companyScoped(a *kit.Args) string {
	if c := kit.Deref(m.companyID); c != "" {
		return ` AND (company_id = ` + a.Add(c) + ` OR company_id IS NULL)`
	}
	return ""
}

// category is resolveCategoryCode: the normalized code when an active
// category exists, "" otherwise.
func (m *rawMaterialImport) category(ctx context.Context, code string) (string, error) {
	normalized := normalizeKategori(code)
	key := kit.FirstNonEmpty(kit.Deref(m.companyID), "*") + ":" + normalized
	ok, cached := m.categories[key]
	if !cached {
		a := &kit.Args{}
		row, err := kit.QueryOne(ctx, m.h.env.DB, `SELECT code FROM item.raw_material_categories
			WHERE deleted_at IS NULL AND is_active = true AND upper(code) = upper(`+a.Add(normalized)+`)`+m.companyScoped(a)+`
			ORDER BY company_id NULLS LAST LIMIT 1`, a.Values...)
		if err != nil {
			return "", err
		}
		ok = row != nil && row.Str("code") != ""
		m.categories[key] = ok
	}
	if !ok {
		return "", nil
	}
	return normalized, nil
}

// unitID is resolveUnitId: the company's unit first, then a global one.
func (m *rawMaterialImport) unitID(ctx context.Context, code string) (string, error) {
	normalized := strings.ToUpper(jsTrim(code))
	key := kit.FirstNonEmpty(kit.Deref(m.companyID), "*") + ":" + normalized
	if id, ok := m.units[key]; ok {
		return id, nil
	}
	a := &kit.Args{}
	row, err := kit.QueryOne(ctx, m.h.env.DB, `SELECT id::text FROM item.units
		WHERE deleted_at IS NULL AND upper(kode) = upper(`+a.Add(normalized)+`)`+m.companyScoped(a)+`
		ORDER BY company_id NULLS LAST LIMIT 1`, a.Values...)
	if err != nil {
		return "", err
	}
	m.units[key] = ""
	if row != nil {
		m.units[key] = row.Str("id")
	}
	return m.units[key], nil
}

// nextCode is generateKode: BHN-YYYY-#### in this company/branch.
func (m *rawMaterialImport) nextCode(ctx context.Context) (string, error) {
	year := m.h.env.Now().In(kit.Jakarta()).Year()
	a := &kit.Args{}
	row, err := kit.QueryOne(ctx, m.h.env.DB, `SELECT kode FROM raw_materials WHERE kode ILIKE `+a.Add(fmt.Sprintf("BHN-%d-%%", year))+
		` AND deleted_at IS NULL AND `+exactScope(a, m.companyID, m.branchID)+` ORDER BY kode DESC LIMIT 1`, a.Values...)
	if err != nil {
		return "", err
	}
	last := ""
	if row != nil {
		last = row.Str("kode")
	}
	return fmt.Sprintf("BHN-%d-%04d", year, nextCodeSequence(last)), nil
}

// references is resolveReferences: units, COA and stall, or the message the
// row is skipped with.
func (m *rawMaterialImport) references(ctx context.Context, f rawMaterialFields, msgs rawMaterialMessages) (*rawMaterialRefs, string, error) {
	refs := &rawMaterialRefs{}
	var err error
	if refs.satuanBesarID, err = m.unitID(ctx, f.satuanBesarKode); err != nil || refs.satuanBesarID == "" {
		return nil, fmt.Sprintf(msgs.largeUnit, f.satuanBesarKode), err
	}
	if f.satuanKecilKode != "" {
		id, err := m.unitID(ctx, f.satuanKecilKode)
		if err != nil || id == "" {
			return nil, fmt.Sprintf(msgs.smallUnit, f.satuanKecilKode), err
		}
		refs.satuanKecilID = &id
	}
	if f.coaRaw != "" && f.coa == nil {
		return nil, msgs.coa, nil
	}
	if f.warehouseCode != "" {
		id, err := m.h.warehouseByCode(ctx, f.warehouseCode, m.branchID, m.warehouses)
		if err != nil || id == "" {
			return nil, `Stall code "` + f.warehouseCode + `" was not found for this branch`, err
		}
		refs.warehouseID = &id
	}
	return refs, "", nil
}

// columns are the raw_materials columns both paths write, in TS order.
func (f rawMaterialFields) columns(row *kit.Row, kategori string, refs *rawMaterialRefs) *kit.Row {
	return row.Set("nama", f.nama).Set("kategori", kategori).Set("deskripsi", f.deskripsi).
		Set("satuan_besar_id", refs.satuanBesarID).Set("satuan_kecil_id", refs.satuanKecilID).
		Set("konversi_factor", f.konversiFactor).Set("stok_minimum", f.stokMinimum).Set("stok_maximum", f.stokMaximum).
		Set("shelf_life_days", f.shelfLifeDays).Set("coa", f.coa).Set("harga_beli", f.hargaBeli)
}

// saveConversions is upsertUnitConversions for the saved material row.
func saveConversions(ctx context.Context, q database.Querier, saved *kit.Row) error {
	// node-postgres reads numeric as text, so `konversi_factor || 1` only
	// falls back on NULL: a saved "0" fails the table's check like the TS.
	var konversi *float64
	if v := saved.Get("konversi_factor"); v != nil && v != "" {
		konversi = kit.Ptr(kit.ToNum(v))
	}
	planned := buildUnitConversions(saved.Str("satuan_besar_id"), saved.StrPtr("satuan_kecil_id"), konversi)
	rows := make([]*kit.Row, len(planned))
	for i, c := range planned {
		rows[i] = kit.Obj("raw_material_id", saved.Str("id"), "satuan_id", c.SatuanID, "qty_in_base_unit", c.QtyInBaseUnit,
			"is_base", c.IsBase, "is_active", true)
	}
	if _, err := kit.Insert(ctx, q, "raw_material_unit_conversions", rows, "raw_material_id,satuan_id", false); err != nil {
		return dbFailure(err)
	}
	return nil
}

func (m *rawMaterialImport) stock(f rawMaterialFields, id, kode string, refs *rawMaterialRefs) ledger.ImportStock {
	return ledger.ImportStock{
		RawMaterialID: id, Qty: f.stockQty, UserID: m.userID, WarehouseID: refs.warehouseID, MaterialKode: kode,
		UnitCost: unitCostForStock(f.hargaBeli, f.konversiFactor, refs.satuanKecilID != nil),
	}
}

// update is updateExisting.
func (m *rawMaterialImport) update(ctx context.Context, existingID, kode, kategori string, f rawMaterialFields) (string, error) {
	refs, msg, err := m.references(ctx, f, updateMessages)
	if err != nil || msg != "" {
		return msg, err
	}
	return m.h.importRow(ctx, func(q database.Querier) error {
		set := f.columns(kit.NewRow(), kategori, refs).Set("is_active", f.isActive)
		saved, err := kit.Update(ctx, q, "raw_materials", set, func(a *kit.Args) string { return `"id" = ` + a.Add(existingID) }, true)
		if err != nil {
			return dbFailure(err)
		}
		if len(saved) == 0 {
			return rowFailure("Failed to update row")
		}
		if err := saveConversions(ctx, q, saved[0]); err != nil {
			return err
		}
		if !f.hasStockValue {
			return nil
		}
		if f.stockQty < 0 {
			return rowFailure("Opening stock cannot be negative")
		}
		// The TS rethrows the query builder's { message } object, which is
		// no Error instance, so every stock failure reads as the fallback.
		if err := ledger.SetStockFromImport(ctx, q, m.stock(f, existingID, kode, refs), m.h.env.Now()); err != nil {
			return rowFailure("Failed to update stock")
		}
		return nil
	})
}

// insert is insertNew; a row failing after its insert rolls the insert
// back (the TS deletes it again).
func (m *rawMaterialImport) insert(ctx context.Context, kode, kategori string, f rawMaterialFields) (string, error) {
	refs, msg, err := m.references(ctx, f, insertMessages)
	if err != nil || msg != "" {
		return msg, err
	}
	if f.stockQty < 0 {
		return "Opening stock cannot be negative", nil
	}
	return m.h.importRow(ctx, func(q database.Querier) error {
		cols := f.columns(kit.Obj("kode", kode), kategori, refs).
			Set("company_id", m.companyID).Set("branch_id", m.branchID).Set("is_active", f.isActive)
		created, err := kit.InsertOne(ctx, q, "raw_materials", cols)
		if err != nil {
			return dbFailure(err)
		}
		if err := saveConversions(ctx, q, created); err != nil {
			return err
		}
		if f.stockQty > 0 {
			if err := ledger.AddOpeningStockFromImport(ctx, q, m.stock(f, created.Str("id"), kode, refs), m.h.env.Now()); err != nil {
				return rowFailure("Failed to create opening stock")
			}
		}
		return nil
	})
}

/* POST /api/purchasing/import/raw-materials: form-data `file` (CSV/XLSX) */
func (h *handler) importRawMaterials(w http.ResponseWriter, r *http.Request) error {
	user, scope, err := h.staffScope(r, h.itemsStaff)
	if err != nil {
		return err
	}
	companyID, branchID := ps.ImportBusinessIDs(scope)
	rows, err := readUploadedSheet(r, rawMaterialHeader)
	if err != nil {
		return err
	}
	ctx := r.Context()
	m := &rawMaterialImport{h: h, userID: user.ID, companyID: kit.OrNil(companyID), branchID: kit.OrNil(branchID),
		units: map[string]string{}, warehouses: map[string]string{}, categories: map[string]bool{}}
	sum := newImportSummary()
	for _, row := range rows {
		f := readRawMaterialRow(row.Data)
		if missing := f.missing(); len(missing) > 0 {
			sum.skip(row.RowNumber, "Required fields missing: "+strings.Join(missing, ", "))
			continue
		}
		kategori, err := m.category(ctx, f.kategori)
		if err != nil {
			return err
		}
		if kategori == "" {
			sum.skip(row.RowNumber, `Category "`+f.kategori+`" not found. Seed categories first or use a valid code.`)
			continue
		}
		kode := jsTrim(row.Data["kode"])
		if kode == "" {
			if kode, err = m.nextCode(ctx); err != nil {
				return err
			}
		}
		a := &kit.Args{}
		existing, err := kit.QueryOne(ctx, h.env.DB, `SELECT id::text FROM raw_materials WHERE kode = `+a.Add(kode)+
			` AND deleted_at IS NULL AND `+exactScope(a, m.companyID, m.branchID)+` LIMIT 1`, a.Values...)
		if err != nil {
			return err
		}
		var failed string
		if existing != nil {
			failed, err = m.update(ctx, existing.Str("id"), kode, kategori, f)
		} else {
			failed, err = m.insert(ctx, kode, kategori, f)
		}
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

/* GET /api/purchasing/export/raw-materials: .xlsx with the raw material import columns */
func (h *handler) exportRawMaterials(w http.ResponseWriter, r *http.Request) error {
	user, scope, err := h.staffScope(r, h.itemsStaff)
	if err != nil {
		return err
	}
	a := &kit.Args{}
	where := kit.ScopeFilters(scope, "rm.", a, []string{"rm.deleted_at IS NULL"})
	// Opening stock follows the sidebar's active stall so the file matches
	// the table on screen. "Semua Stall" uses the branch's default
	// warehouse: not every branch has a MAIN code to import back into.
	warehouseJoin := `wh.branch_id = rm.branch_id AND wh.is_default = true AND wh.is_active = true`
	active, err := stall.Active(r.Context(), h.env.DB, r, user.ID)
	if err != nil {
		return err
	}
	if active != "" {
		warehouseJoin = `wh.id = ` + a.Add(active) + ` AND wh.is_active = true`
	}
	return h.exportSheet(w, r, "Raw Materials", "raw-materials", rawMaterialColumns, `SELECT
		rm.kode::text, rm.nama::text, rm.kategori::text, ub.kode::text, uk.kode::text,
		COALESCE(rm.konversi_factor::text, '1'), COALESCE(rm.stok_minimum::text, '0'), rm.stok_maximum::text,
		rm.shelf_life_days::text, rm.coa::text, COALESCE(rm.harga_beli, 0)::text, COALESCE(inv.qty_available, 0)::text,
		COALESCE(wh.code, '')::text, rm.deskripsi::text,
		CASE WHEN rm.is_active THEN 'active' ELSE 'inactive' END
		FROM item.raw_materials rm
		LEFT JOIN item.units ub ON ub.id = rm.satuan_besar_id
		LEFT JOIN item.units uk ON uk.id = rm.satuan_kecil_id
		LEFT JOIN configuration.warehouses wh ON `+warehouseJoin+`
		LEFT JOIN inventory.inventory inv ON inv.raw_material_id = rm.id AND inv.warehouse_id = wh.id AND inv.is_active = true
		WHERE `+strings.Join(where, " AND ")+`
		ORDER BY rm.nama ASC`, a.Values...)
}
