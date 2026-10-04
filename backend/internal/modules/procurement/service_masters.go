package procurement

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"

	"nuhabit/backend/internal/modules/procurement/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	pscope "nuhabit/backend/internal/platform/scope"
)

// Port of lib/purchasing/supplier-service.ts, supplier-price-history.ts,
// vendor-directory.ts and vendor-price-list.ts.

// fields is an ordered column → value list for INSERT/UPDATE; a column's
// cast lets PostgreSQL parse strings (dates, uuids) and round numerics.
type fields struct {
	cols  []string
	vals  []any
	casts []string
}

func (f *fields) set(col string, v any, cast string) *fields {
	for i, c := range f.cols {
		if c == col {
			f.vals[i], f.casts[i] = v, cast
			return f
		}
	}
	f.cols, f.vals, f.casts = append(f.cols, col), append(f.vals, v), append(f.casts, cast)
	return f
}

func (f *fields) insertSQL(table string) (string, []any) {
	ph := make([]string, len(f.cols))
	for i := range f.cols {
		ph[i] = "$" + itoa(i+1) + f.casts[i]
	}
	return `INSERT INTO ` + table + ` (` + strings.Join(f.cols, ", ") + `) VALUES (` + strings.Join(ph, ", ") + `) RETURNING *`, f.vals
}

// updateSQL renders `UPDATE table SET … WHERE <where> RETURNING *`; where
// uses $1 for the id.
func (f *fields) updateSQL(table, where string, id any) (string, []any) {
	sets := make([]string, len(f.cols))
	for i, c := range f.cols {
		sets[i] = c + " = $" + itoa(i+2) + f.casts[i]
	}
	return `UPDATE ` + table + ` SET ` + strings.Join(sets, ", ") + ` WHERE ` + where + ` RETURNING *`, append([]any{id}, f.vals...)
}

/* ── Suppliers ───────────────────────────────────────────────────────── */

// SupplierListParams is supplierListQuerySchema.
type SupplierListParams struct {
	Search, Status, PaymentTerms *string
	IsActive                     *bool
	Page, Limit                  float64
	SortBy, SortDir              string
}

var supplierSortColumns = map[string]string{"nama_supplier": "nama_supplier", "kode_supplier": "kode", "kota": "kota", "created_at": "created_at"}

var supplierSearchColumns = []string{"nama_supplier", "kode", "kota", "pic_name", "pic_phone", "pic_email", "telepon", "email", "alamat", "npwp", "payment_terms", "kategori", "catatan", "status"}

// scopeFilters adds companyScopeOr / branchScopeOr.
func scopeFilters(w *where, scope *pscope.Scope) *where {
	if c := pscope.CompanyFilter(scope); c != nil {
		w.add("company_id = %s::text::uuid", *c)
	}
	if b := pscope.BranchFilter(scope); b != nil {
		w.add("branch_id = %s::text::uuid", *b)
	}
	return w
}

// orIlike is .or("a.ilike.%x%,b.ilike.%x%") with "*" as a wildcard.
func orIlike(w *where, cols []string, search string) {
	pattern := strings.ReplaceAll("%"+search+"%", "*", "%")
	parts := make([]string, len(cols))
	for i, c := range cols {
		parts[i] = c + " ILIKE " + w.next(pattern)
	}
	w.clauses = append(w.clauses, "("+strings.Join(parts, " OR ")+")")
}

func (s *Service) pageOf(ctx context.Context, table, selectCols string, w *where, order string, page, limit float64) ([]*Row, int, error) {
	var total int
	if err := s.db.QueryRow(ctx, `SELECT count(*)::int FROM `+table+` `+w.sql(), w.args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	l, o := w.next(formatJSNumber(limit)), w.next(formatJSNumber((page-1)*limit))
	rows, err := s.rows.Query(ctx, s.db, `SELECT `+selectCols+` FROM `+table+` `+w.sql()+` ORDER BY `+order+
		` LIMIT `+l+`::text::bigint OFFSET `+o+`::text::bigint`, w.args...)
	return rows, total, err
}

// ListSuppliers is listSuppliers (camelCase totalPages, no success wrapper).
func (s *Service) ListSuppliers(ctx context.Context, p SupplierListParams, scope *pscope.Scope) (any, error) {
	w := scopeFilters(newWhere().add("deleted_at IS NULL"), scope)
	switch {
	case p.Status != nil:
		w.add("status = %s", *p.Status)
	case p.IsActive != nil:
		w.add("is_active = %s", *p.IsActive)
	}
	if p.PaymentTerms != nil {
		w.add("payment_terms = %s", *p.PaymentTerms)
	}
	if set(p.Search) {
		orIlike(w, supplierSearchColumns, *p.Search)
	}
	dir := "DESC"
	if p.SortDir == "ASC" {
		dir = "ASC"
	}
	rows, total, err := s.pageOf(ctx, "suppliers", "*", w, supplierSortColumns[p.SortBy]+" "+dir, p.Page, p.Limit)
	if err != nil {
		return nil, err
	}
	return struct {
		Data       []*Row   `json:"data"`
		Pagination pageMeta `json:"pagination"`
	}{rows, meta(p.Page, p.Limit, total)}, nil
}

// SupplierCreate is supplierCreateSchema: the sent (or defaulted) columns.
type SupplierCreate struct {
	KodeSupplier *string
	Fields       *fields
	Status       string
}

// CreateSupplier is createSupplier.
func (s *Service) CreateSupplier(ctx context.Context, in *SupplierCreate, userID string, scope *pscope.Scope) (*Row, error) {
	company, branch := pscope.EffectiveCompanyID(scope), pscope.EffectiveBranchID(scope)
	kode := deref(in.KodeSupplier)
	if strings.TrimSpace(kode) == "" || strings.Contains(kode, "XXXX") {
		year := s.now().In(s.loc).Year()
		var last *string
		if err := s.db.QueryRow(ctx, `SELECT kode FROM suppliers WHERE kode ILIKE $1 ORDER BY kode DESC LIMIT 1`, fmt.Sprintf("SUP-%d-%%", year)).Scan(&last); err != nil && !database.IsNoRows(err) {
			return nil, err
		}
		kode = domain.NextDocumentNumber(fmt.Sprintf("SUP-%d", year), last)
	}
	var exists bool
	if err := s.db.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM suppliers WHERE kode = $1 AND deleted_at IS NULL
		AND company_id IS NOT DISTINCT FROM $2::uuid AND branch_id IS NOT DISTINCT FROM $3::uuid)`, kode, company, branch).Scan(&exists); err != nil {
		return nil, err
	}
	if exists {
		return nil, httpx.Conflict("Kode supplier sudah digunakan")
	}
	f := (&fields{}).set("kode", kode, "").set("company_id", company, "").set("branch_id", branch, "")
	for i, c := range in.Fields.cols {
		f.set(c, in.Fields.vals[i], in.Fields.casts[i])
	}
	f.set("is_active", in.Status != "inactive", "").set("created_by", userID, "")
	sql, args := f.insertSQL("suppliers")
	row, err := s.rows.One(ctx, s.db, sql, args...)
	if database.IsUniqueViolation(err) {
		return nil, httpx.Conflict("Kode supplier sudah digunakan")
	}
	return row, err
}

// SupplierDetail is getSupplierDetail: the supplier plus PO analytics.
func (s *Service) SupplierDetail(ctx context.Context, id string) (*Row, error) {
	sup, err := s.rows.One(ctx, s.db, `SELECT * FROM suppliers WHERE id = $1::text::uuid AND deleted_at IS NULL`, id)
	if err != nil || sup == nil {
		return nil, notFound("Supplier tidak ditemukan")
	}
	var activeCount, closedCount int
	var activeTotal, closedTotal float64
	_ = s.db.QueryRow(ctx, `SELECT count(*)::int, COALESCE(SUM(total), 0)::float8 FROM purchase_orders WHERE supplier_id = $1 AND status IN ('draft', 'sent', 'partial')`, sup.Str("id")).Scan(&activeCount, &activeTotal)
	since := s.now().In(s.loc).AddDate(0, -12, 0)
	_ = s.db.QueryRow(ctx, `SELECT count(*)::int, COALESCE(SUM(total), 0)::float8 FROM purchase_orders WHERE supplier_id = $1 AND created_at >= $2 AND status IN ('received', 'closed')`, sup.Str("id"), since).Scan(&closedCount, &closedTotal)
	materials := []string{}
	rows, err := s.rows.Query(ctx, s.db, `SELECT poi.raw_material_id FROM (SELECT id FROM purchase_orders WHERE supplier_id = $1 LIMIT 5) po
		JOIN purchase_order_items poi ON poi.purchase_order_id = po.id`, sup.Str("id"))
	if err == nil {
		names, _ := s.ports.Catalog.Refs(ctx, s.db, EntityRawMaterial, "id, nama", uniqueStrings(column(rows, "raw_material_id")))
		seen := map[string]bool{}
		for _, r := range rows {
			if raw, ok := names[r.Str("raw_material_id")]; ok {
				if m, err := decodeRow(raw); err == nil && m.Str("nama") != "" && !seen[m.Str("nama")] && len(materials) < 5 {
					seen[m.Str("nama")] = true
					materials = append(materials, m.Str("nama"))
				}
			}
		}
	}
	return sup.Set("analytics", obj("po_aktif_count", activeCount, "po_aktif_nilai", activeTotal,
		"total_transaksi_12_bulan", closedTotal, "jumlah_po_12_bulan", closedCount, "on_time_delivery_rate", 0,
		"bahan_sering_dibeli", materials)), nil
}

func (s *Service) supplierExists(ctx context.Context, id string) error {
	var ok bool
	err := s.db.QueryRow(ctx, `SELECT true FROM suppliers WHERE id = $1::text::uuid AND deleted_at IS NULL`, id).Scan(&ok)
	if err != nil || !ok {
		return notFound("Supplier tidak ditemukan")
	}
	return nil
}

// UpdateSupplier is updateSupplier.
func (s *Service) UpdateSupplier(ctx context.Context, id string, f *fields, npwp *string, userID string) (*Row, error) {
	if err := s.supplierExists(ctx, id); err != nil {
		return nil, err
	}
	if npwp != nil && *npwp != "" && !domain.ValidNPWP(*npwp) {
		return nil, badRequest("Format NPWP tidak valid. Gunakan format: XX.XXX.XXX.X-XXX.XXX")
	}
	f.set("updated_by", userID, "")
	sql, args := f.updateSQL("suppliers", "id = $1::text::uuid AND deleted_at IS NULL", id)
	row, err := s.rows.One(ctx, s.db, sql, args...)
	if err != nil {
		return nil, err
	}
	if row == nil {
		return nil, errNoRows
	}
	return row, nil
}

// DeleteSupplier soft-deletes a supplier without active POs.
func (s *Service) DeleteSupplier(ctx context.Context, id, userID string) error {
	if err := s.supplierExists(ctx, id); err != nil {
		return err
	}
	var n int
	_ = s.db.QueryRow(ctx, `SELECT count(*)::int FROM purchase_orders WHERE supplier_id = $1::text::uuid AND status IN ('draft', 'sent', 'partial')`, id).Scan(&n)
	if n > 0 {
		return httpx.Conflict(fmt.Sprintf("Tidak dapat menghapus supplier. Terdapat %d PO aktif (DRAFT/SENT/PARTIAL) yang masih terkait dengan supplier ini.", n))
	}
	_, err := s.db.Exec(ctx, `UPDATE suppliers SET is_active = false, status = 'inactive', deleted_by = $2, deleted_at = $3, updated_by = $2
		WHERE id = $1::text::uuid AND deleted_at IS NULL`, id, userID, s.now())
	return err
}

// SupplierPriceHistory is getSupplierPriceHistory.
func (s *Service) SupplierPriceHistory(ctx context.Context, supplierID string, materialID *string, months, page, limit int) (any, error) {
	start := s.now().In(s.loc).AddDate(0, -months, 0).UTC().Format("2006-01-02")
	type pageT struct {
		Page       int `json:"page"`
		Limit      int `json:"limit"`
		Total      int `json:"total"`
		TotalPages any `json:"total_pages"`
	}
	type out struct {
		Success    bool   `json:"success"`
		Data       []*Row `json:"data"`
		Pagination pageT  `json:"pagination"`
	}
	grns, err := s.rows.Query(ctx, s.db, `SELECT id, nomor_grn, tanggal_penerimaan FROM grn WHERE supplier_id = $1::text::uuid
		AND tanggal_penerimaan >= $2::text::date ORDER BY tanggal_penerimaan DESC LIMIT 1000`, supplierID, start)
	if err != nil {
		return nil, err
	}
	if len(grns) == 0 {
		return out{Success: true, Data: []*Row{}, Pagination: pageT{Page: page, Limit: limit, TotalPages: 0}}, nil
	}
	grnByID := map[string]*Row{}
	for _, g := range grns {
		grnByID[g.Str("id")] = g
	}
	movements, err := s.ports.Pricing.GrnMovements(ctx, s.db, column(grns, "id"), materialID)
	if err != nil {
		return nil, err
	}
	var priced []*Row
	for _, m := range movements {
		if m.Num("unit_cost") > 0 {
			priced = append(priced, m)
		}
	}
	materials := map[string]*Row{}
	refs, err := s.ports.Catalog.Refs(ctx, s.db, EntityRawMaterial, "id, nama, satuan_besar_id, satuan_kecil_id", uniqueStrings(column(priced, "raw_material_id")))
	if err != nil {
		return nil, err
	}
	var unitIDs []string
	for id, raw := range refs {
		if materials[id], err = decodeRow(raw); err != nil {
			return nil, err
		}
		unitIDs = append(unitIDs, jsOrValues(materials[id].Get("satuan_kecil_id"), materials[id].Get("satuan_besar_id"), "").(string))
	}
	unitRefs, err := s.ports.Catalog.Refs(ctx, s.db, EntityUnit, "id, nama", uniqueStrings(unitIDs))
	if err != nil {
		return nil, err
	}
	var supplierName string
	_ = s.db.QueryRow(ctx, `SELECT COALESCE(nama_supplier, '') FROM suppliers WHERE id = $1::text::uuid`, supplierID).Scan(&supplierName)

	sort.SliceStable(priced, func(i, j int) bool {
		return time.Time(priced[i].Get("created_at").(httpx.JSTime)).Before(time.Time(priced[j].Get("created_at").(httpx.JSTime)))
	})
	last := map[string]float64{}
	history := make([]*Row, len(priced))
	for i, m := range priced {
		mat := materials[m.Str("raw_material_id")]
		grn := grnByID[m.Str("reference_id")]
		harga := m.Num("unit_cost")
		var previous, change any
		if p, ok := last[m.Str("raw_material_id")]; ok {
			previous = p
			if p > 0 {
				change = (harga - p) / p * 100
			}
		}
		last[m.Str("raw_material_id")] = harga
		name, unitName := any("-"), any("")
		if mat != nil {
			if n := mat.Str("nama"); n != "" {
				name = n
			}
			unit := jsOrValues(mat.Get("satuan_kecil_id"), mat.Get("satuan_besar_id"), "").(string)
			if raw, ok := unitRefs[unit]; ok && unit != "" {
				if u, err := decodeRow(raw); err == nil && u.Str("nama") != "" {
					unitName = u.Str("nama")
				}
			}
		}
		var tanggal, ref any = m.Get("created_at"), m.Get("reference_number")
		if grn != nil {
			if grn.Get("tanggal_penerimaan") != nil {
				tanggal = grn.Get("tanggal_penerimaan")
			}
			if ref == nil || ref == "" {
				ref = grn.Get("nomor_grn")
			}
		}
		if ref == "" {
			ref = nil
		}
		history[i] = obj("id", m.Get("id"), "supplier_id", supplierID, "nama_supplier", supplierName,
			"bahan_baku_id", m.Get("raw_material_id"), "bahan_baku_nama", name, "harga", harga, "qty", m.Num("jumlah"),
			"satuan_nama", unitName, "tanggal", tanggal, "reference_number", ref, "previous_price", previous, "price_change_percent", change)
	}
	for i, j := 0, len(history)-1; i < j; i, j = i+1, j-1 {
		history[i], history[j] = history[j], history[i]
	}
	from := (page - 1) * limit
	pageRows := []*Row{}
	if from < len(history) {
		pageRows = history[from:min(len(history), from+limit)]
	}
	return out{Success: true, Data: pageRows, Pagination: pageT{Page: page, Limit: limit, Total: len(history), TotalPages: totalPages(len(history), limit)}}, nil
}

/* ── Vendors ─────────────────────────────────────────────────────────── */

// VendorListParams is vendorListQuerySchema.
type VendorListParams struct {
	Search, Category, UsageScope, Status *string
	Page, Limit                          float64
}

// listPage is pageMeta of vendor-directory: at least one page.
type listPage struct {
	Page       float64 `json:"page"`
	Limit      float64 `json:"limit"`
	Total      int     `json:"total"`
	TotalPages any     `json:"total_pages"`
}

func minOnePage(page, limit float64, total int) listPage {
	tp := totalPagesF(float64(total), limit)
	if f, ok := tp.(float64); ok && f < 1 {
		tp = 1.0
	}
	return listPage{Page: page, Limit: limit, Total: total, TotalPages: tp}
}

type listBody struct {
	Data       []*Row   `json:"data"`
	Pagination listPage `json:"pagination"`
}

// ListVendors is listVendors.
func (s *Service) ListVendors(ctx context.Context, p VendorListParams, scope *pscope.Scope) (any, error) {
	w := scopeFilters(newWhere(), scope)
	switch deref(p.Status) {
	case "active":
		w.add("is_active = true")
	case "inactive":
		w.add("is_active = false")
	}
	if p.Category != nil {
		w.add("category = %s", *p.Category)
	}
	if p.UsageScope != nil {
		if *p.UsageScope == "keduanya" {
			w.add("usage_scope = 'keduanya'")
		} else {
			w.add("usage_scope IN (%s, 'keduanya')", *p.UsageScope)
		}
	}
	if set(p.Search) {
		orIlike(w, []string{"name", "code", "contact_person"}, *p.Search)
	}
	rows, total, err := s.pageOf(ctx, "vendors", "*", w, "name ASC", p.Page, p.Limit)
	if err != nil {
		return nil, err
	}
	return listBody{rows, minOnePage(p.Page, p.Limit, total)}, nil
}

// CreateVendor is createVendor with the next V-YYYY-NNNN code.
func (s *Service) CreateVendor(ctx context.Context, f *fields, scope *pscope.Scope) (*Row, error) {
	year := s.now().In(s.loc).Year()
	var last *string
	if err := s.db.QueryRow(ctx, `SELECT code FROM vendors WHERE code ILIKE $1 ORDER BY code DESC LIMIT 1`, fmt.Sprintf("V-%d-%%", year)).Scan(&last); err != nil && !database.IsNoRows(err) {
		return nil, err
	}
	all := (&fields{}).set("code", domain.NextVendorCode(year, last), "")
	for i, c := range f.cols {
		all.set(c, f.vals[i], f.casts[i])
	}
	all.set("company_id", pscope.EffectiveCompanyID(scope), "").set("branch_id", pscope.EffectiveBranchID(scope), "").set("is_active", true, "")
	sql, args := all.insertSQL("vendors")
	return s.rows.One(ctx, s.db, sql, args...)
}

// ScopedVendor is getScopedVendor: out-of-scope vendors read as missing.
func (s *Service) ScopedVendor(ctx context.Context, id string, scope *pscope.Scope) (*Row, error) {
	v, err := s.rows.One(ctx, s.db, `SELECT * FROM vendors WHERE id = $1::text::uuid`, id)
	if err != nil || v == nil || !pscope.RowInScope(scope, v.StrPtr("company_id"), v.StrPtr("branch_id")) {
		return nil, notFound("Vendor not found")
	}
	return v, nil
}

// UpdateVendor writes the sent columns.
func (s *Service) UpdateVendor(ctx context.Context, id string, f *fields, scope *pscope.Scope) (*Row, error) {
	v, err := s.ScopedVendor(ctx, id, scope)
	if err != nil {
		return nil, err
	}
	if len(f.cols) == 0 {
		// An empty .update({}) renders "SET  WHERE" in the query builder: 42601 → 500.
		return nil, errEmptyUpdate
	}
	sql, args := f.updateSQL("vendors", "id = $1", v.Str("id"))
	return s.rows.One(ctx, s.db, sql, args...)
}

var errEmptyUpdate = fmt.Errorf("syntax error: empty UPDATE")

// DeactivateVendor is deactivateVendor.
func (s *Service) DeactivateVendor(ctx context.Context, id string, scope *pscope.Scope) error {
	v, err := s.ScopedVendor(ctx, id, scope)
	if err != nil {
		return err
	}
	_, err = s.db.Exec(ctx, `UPDATE vendors SET is_active = false WHERE id = $1`, v.Str("id"))
	return err
}

/* ── Vendor price lists ──────────────────────────────────────────────── */

// PriceListParams is priceListQuerySchema.
type PriceListParams struct {
	Search, VendorID, ProductID, Status *string
	Page, Limit                         float64
}

// embedPriceRefs adds vendor (columns per screen), product and unit.
func (s *Service) embedPriceRefs(ctx context.Context, rows []*Row, vendorCols string) error {
	vendors := map[string]json.RawMessage{}
	if ids := uniqueStrings(column(rows, "vendor_id")); len(ids) > 0 {
		list, err := s.rows.Query(ctx, s.db, `SELECT e.id::text AS id, row_to_json(e) AS v FROM (SELECT `+vendorCols+` FROM purchasing.vendors WHERE id = ANY($1::uuid[])) e`, ids)
		if err != nil {
			return err
		}
		for _, r := range list {
			vendors[r.Str("id")], _ = r.Get("v").(json.RawMessage)
		}
	}
	products, err := s.ports.Catalog.Refs(ctx, s.db, EntityProduct, "id, kode, nama, satuan_id", uniqueStrings(column(rows, "product_id")))
	if err != nil {
		return err
	}
	units, err := s.ports.Catalog.Refs(ctx, s.db, EntityUnit, "id, kode, nama", uniqueStrings(column(rows, "satuan_id")))
	if err != nil {
		return err
	}
	for _, r := range rows {
		r.Set("vendor", refOrNull(vendors, r.Str("vendor_id")))
		r.Set("product", refOrNull(products, r.Str("product_id")))
		r.Set("unit", refOrNull(units, r.Str("satuan_id")))
	}
	return nil
}

// ListPriceLists is listPriceLists: a search matches vendor name or code
// and active product name or code.
func (s *Service) ListPriceLists(ctx context.Context, p PriceListParams, scope *pscope.Scope) (any, error) {
	w := scopeFilters(newWhere(), scope)
	switch deref(p.Status) {
	case "active":
		w.add("is_active = true")
	case "inactive":
		w.add("is_active = false")
	}
	if p.VendorID != nil {
		w.add("vendor_id = %s::text::uuid", *p.VendorID)
	}
	if p.ProductID != nil {
		w.add("product_id = %s::text::uuid", *p.ProductID)
	}
	if set(p.Search) {
		term := strings.ReplaceAll("%"+*p.Search+"%", "*", "%")
		products, err := s.ports.Catalog.ProductIDsMatching(ctx, s.db, term)
		if err != nil {
			return nil, err
		}
		w.add("(vendor_id IN (SELECT id FROM vendors WHERE name ILIKE %s OR code ILIKE %s) OR product_id = ANY(%s::uuid[]))", term, term, products)
	}
	rows, total, err := s.pageOf(ctx, "vendor_price_lists", "*", w, "is_preferred DESC, created_at DESC", p.Page, p.Limit)
	if err != nil {
		return nil, err
	}
	if err := s.embedPriceRefs(ctx, rows, "id, code, name"); err != nil {
		return nil, err
	}
	return listBody{rows, minOnePage(p.Page, p.Limit, total)}, nil
}

// priceListUnit is resolveProductUnit + pickPriceListUnit.
func (s *Service) priceListUnit(ctx context.Context, productID, requested string) (string, error) {
	found, unit, err := s.ports.Catalog.ProductUnit(ctx, s.db, productID)
	if err != nil || !found {
		return "", badRequest("Product not found")
	}
	resolved := requested
	if resolved == "" {
		resolved = deref(unit)
	}
	if resolved == "" {
		return "", badRequest("Product unit is not configured")
	}
	if requested != "" && deref(unit) != "" && requested != *unit {
		return "", badRequest("Unit must match the product base unit")
	}
	return resolved, nil
}

const duplicatePriceList = "A price list for this vendor and product already exists"

// PriceListCreate is priceListCreateSchema.
type PriceListCreate struct {
	VendorID, ProductID         string
	Harga, MinimumQty, LeadTime float64
	SatuanID                    *string
	IsPreferred                 bool
	BerlakuDari, BerlakuSampai  *string
	Catatan                     *string
}

// CreatePriceList is createPriceList (the response row carries no embeds).
func (s *Service) CreatePriceList(ctx context.Context, in *PriceListCreate, scope *pscope.Scope) (*Row, error) {
	unit, err := s.priceListUnit(ctx, in.ProductID, deref(in.SatuanID))
	if err != nil {
		return nil, err
	}
	var active bool
	if err := s.db.QueryRow(ctx, `SELECT is_active FROM vendors WHERE id = $1::text::uuid`, in.VendorID).Scan(&active); err != nil {
		return nil, badRequest("Vendor not found")
	}
	if !active {
		return nil, badRequest("Vendor is inactive")
	}
	dari := deref(in.BerlakuDari)
	if dari == "" {
		dari = s.now().UTC().Format("2006-01-02")
	}
	row, err := s.rows.One(ctx, s.db, `INSERT INTO vendor_price_lists
		(vendor_id, product_id, harga, satuan_id, minimum_qty, lead_time_days, is_preferred, berlaku_dari, berlaku_sampai, catatan, company_id, branch_id, is_active)
		VALUES ($1::text::uuid, $2::text::uuid, $3, $4::text::uuid, $5, $6::numeric, $7, $8::text::date, $9::text::date, $10, $11, $12, true) RETURNING *`,
		in.VendorID, in.ProductID, in.Harga, unit, in.MinimumQty, in.LeadTime, in.IsPreferred, dari, in.BerlakuSampai, in.Catatan,
		pscope.EffectiveCompanyID(scope), pscope.EffectiveBranchID(scope))
	if database.IsUniqueViolation(err) {
		return nil, badRequest(duplicatePriceList)
	}
	return row, err
}

func (s *Service) scopedPriceList(ctx context.Context, id string, scope *pscope.Scope) (*Row, error) {
	r, err := s.rows.One(ctx, s.db, `SELECT * FROM vendor_price_lists WHERE id = $1::text::uuid`, id)
	if err != nil || r == nil || !pscope.RowInScope(scope, r.StrPtr("company_id"), r.StrPtr("branch_id")) {
		return nil, notFound("Price list not found")
	}
	return r, nil
}

// PriceList is getPriceList (detail vendor columns).
func (s *Service) PriceList(ctx context.Context, id string, scope *pscope.Scope) (*Row, error) {
	r, err := s.scopedPriceList(ctx, id, scope)
	if err != nil {
		return nil, err
	}
	return r, s.embedPriceRefs(ctx, []*Row{r}, "id, code, name, contact_person, phone, email")
}

// UpdatePriceList is updatePriceList (the response row carries no embeds).
func (s *Service) UpdatePriceList(ctx context.Context, id string, f *fields, productID, satuanID *string, scope *pscope.Scope) (*Row, error) {
	existing, err := s.scopedPriceList(ctx, id, scope)
	if err != nil {
		return nil, err
	}
	f.set("updated_at", s.now(), "")
	if deref(productID) != "" || deref(satuanID) != "" {
		product, unit := deref(productID), deref(satuanID)
		if product == "" {
			product = existing.Str("product_id")
		}
		if unit == "" {
			unit = existing.Str("satuan_id")
		}
		resolved, err := s.priceListUnit(ctx, product, unit)
		if err != nil {
			return nil, err
		}
		f.set("satuan_id", resolved, "::text::uuid")
	}
	sql, args := f.updateSQL("vendor_price_lists", "id = $1", existing.Str("id"))
	row, err := s.rows.One(ctx, s.db, sql, args...)
	if database.IsUniqueViolation(err) {
		return nil, badRequest(duplicatePriceList)
	}
	return row, err
}

// DeactivatePriceList is deactivatePriceList.
func (s *Service) DeactivatePriceList(ctx context.Context, id string, scope *pscope.Scope) error {
	existing, err := s.scopedPriceList(ctx, id, scope)
	if err != nil {
		return err
	}
	now := s.now()
	_, err = s.db.Exec(ctx, `UPDATE vendor_price_lists SET is_active = false, deleted_at = $2, updated_at = $2 WHERE id = $1`, existing.Str("id"), now)
	return err
}
