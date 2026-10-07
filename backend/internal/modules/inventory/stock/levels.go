package stock

import (
	"net/http"
	ps "nuhabit/backend/internal/platform/scope"
	"regexp"
	"strings"

	"nuhabit/backend/internal/modules/inventory/domain"
	"nuhabit/backend/internal/modules/inventory/kit"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/validate"
)

// pageWindow is `(page - 1) * limit` and the shim's range(): LIMIT and
// OFFSET go to PostgreSQL as the JS numbers, so NaN or fractions fail there
// (400 "Format data tidak valid") as they do from TS.
func pageWindow(a *kit.Args, page, limit float64) string {
	from := (page - 1) * limit
	to := from + limit - 1
	return " LIMIT " + a.Add(kit.N(to-from+1)) + " OFFSET " + a.Add(kit.N(from))
}

// countAndList runs the shim's count(*)::int then the page query.
func (h *handler) countAndList(r *http.Request, from, where string, args *kit.Args, order string, page, limit float64) (kit.Rows, int, error) {
	ctx := r.Context()
	if where != "" {
		where = " WHERE " + where
	}
	var total int
	if err := h.env.DB.QueryRow(ctx, `SELECT count(*)::int AS count FROM `+from+where, args.Values...).Scan(&total); err != nil {
		return nil, 0, err
	}
	pageArgs := &kit.Args{Values: append([]any(nil), args.Values...)}
	rows, err := kit.Query(ctx, h.env.DB, `SELECT * FROM `+from+where+` ORDER BY `+order+pageWindow(pageArgs, page, limit), pageArgs.Values...)
	return rows, total, err
}

/* GET /api/inventory — v_inventory, paged. */
func (h *handler) listInventory(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.inventoryStaff(r); err != nil {
		return err
	}
	sp := r.URL.Query()
	search, status := sp.Get("search"), sp.Get("status")
	page, limit := kit.NumberParam(sp, "page", 1), kit.NumberParam(sp, "limit", 20)
	a := &kit.Args{}
	var where []string
	if status != "" {
		where = append(where, `"stock_status" = `+a.Add(status))
	}
	if search != "" {
		where = append(where, kit.Search(a, "", search, "material_nama", "material_kode"))
	}
	rows, total, err := h.countAndList(r, `v_inventory`, strings.Join(where, " AND "), a, `"material_nama" ASC`, page, limit)
	if err != nil {
		return err
	}
	return kit.Paginated(w, rows, kit.Pagination{Page: kit.Float(page), Limit: kit.Float(limit), Total: total}, "Inventory retrieved")
}

/* GET /api/inventory/{id}/movements */
func (h *handler) inventoryMovements(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.inventoryStaff(r); err != nil {
		return err
	}
	sp := r.URL.Query()
	page, limit := kit.NumberParam(sp, "page", 1), kit.NumberParam(sp, "limit", 25)
	a := &kit.Args{}
	where := `"inventory_id" = ` + a.Add(r.PathValue("id")) + ` AND "is_active" = ` + a.Add(true)
	rows, total, err := h.countAndList(r, `inventory_movements`, where, a, `"created_at" DESC`, page, limit)
	if err != nil {
		return err
	}
	return kit.Paginated(w, rows, kit.Pagination{Page: kit.Float(page), Limit: kit.Float(limit), Total: total}, "Movements retrieved")
}

var looseUUID = regexp.MustCompile(`(?i)^[0-9a-f-]{36}$`)

/* GET /api/inventory/batches?raw_material_id=&warehouse_id= — open batches, FEFO. */
func (h *handler) batches(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.inventoryStaff(r); err != nil {
		return err
	}
	f := kit.FromRequest(r, "")
	check := kit.Pattern(looseUUID, "/^[0-9a-f-]{36}$/i")
	rm := f.Str("raw_material_id", validate.Rule{}, validate.StrOpts{Check: check})
	wh := f.Str("warehouse_id", validate.Rule{}, validate.StrOpts{Check: check})
	if err := f.FlattenErr("raw_material_id dan warehouse_id wajib"); err != nil {
		return err
	}
	rows, err := kit.Query(r.Context(), h.env.DB, `SELECT b.id, b.batch_number, b.expiry_date::text AS expiry_date,
		b.qty_remaining::float8 AS qty_remaining, b.received_at::text AS received_at, b.source_type
		FROM inventory.stock_batches b
		JOIN inventory.inventory inv ON inv.id = b.inventory_id
		WHERE b.raw_material_id = $1 AND inv.warehouse_id = $2 AND b.qty_remaining > 0
		ORDER BY b.expiry_date ASC NULLS LAST, b.received_at ASC`, *rm, *wh)
	if err != nil {
		return err
	}
	return kit.Data(w, rows)
}

// scopeClause is stock-queries.ts scopeClause on a branch column.
func scopeClause(s *ps.Scope, branchColumn string, a *kit.Args) string {
	if s == nil || s.Unscoped {
		return ""
	}
	switch {
	case s.Level() == "branch" && kit.Deref(s.BranchID) != "":
		return branchColumn + " = " + a.Add(kit.Deref(s.BranchID))
	case s.Level() == "company" && kit.Deref(s.CompanyID) != "":
		return branchColumn + " IN (SELECT id FROM configuration.branches WHERE company_id = " + a.Add(kit.Deref(s.CompanyID)) + ")"
	}
	return ""
}

/* GET /api/inventory/expiry */
func (h *handler) expiry(w http.ResponseWriter, r *http.Request) error {
	_, scope, err := h.staffScope(r, h.inventoryStaff)
	if err != nil {
		return err
	}
	f := kit.FromRequest(r, "")
	days := f.CoerceInt("days", 30, validate.NumOpts{Integer: true, Min: validate.Bound(0), Max: validate.Bound(365)})
	status := f.Str("status", validate.Rule{HasDefault: true}, validate.StrOpts{Check: validate.EnumCheck([]string{"all", "near", "expired"})})
	warehouseID := f.UUID("warehouse_id", validate.Rule{Optional: true})
	branchID := f.UUID("branch_id", validate.Rule{Optional: true})
	search := f.Str("search", validate.Rule{Optional: true}, validate.StrOpts{Max: 100})
	if err := f.FlattenErr("Filter tidak valid"); err != nil {
		return err
	}
	st := "all"
	if status != nil {
		st = *status
	}
	today := kit.TodayJakarta(h.env.Now())
	horizon := kit.AddDays(today, max(0, days))
	a := &kit.Args{}
	where := []string{"b.qty_remaining > 0", "b.expiry_date IS NOT NULL"}
	switch st {
	case "expired":
		where = append(where, "b.expiry_date < "+a.Add(today)+"::date")
	case "near":
		where = append(where, "b.expiry_date >= "+a.Add(today)+"::date", "b.expiry_date <= "+a.Add(horizon)+"::date")
	default:
		where = append(where, "b.expiry_date <= "+a.Add(horizon)+"::date")
	}
	if warehouseID != nil && *warehouseID != "" {
		where = append(where, "b.warehouse_id = "+a.Add(*warehouseID))
	}
	if branchID != nil && *branchID != "" {
		where = append(where, "b.branch_id = "+a.Add(*branchID))
	}
	if search != nil && strings.TrimSpace(*search) != "" {
		term := a.Add("%" + strings.TrimSpace(*search) + "%")
		where = append(where, "(rm.nama ILIKE "+term+" OR rm.kode ILIKE "+term+" OR b.batch_number ILIKE "+term+")")
	}
	if c := scopeClause(scope, "b.branch_id", a); c != "" {
		where = append(where, c)
	}
	todayParam := a.Add(today)
	rows, err := kit.Query(r.Context(), h.env.DB, `SELECT b.id, b.inventory_id, b.raw_material_id, rm.kode AS material_kode, rm.nama AS material_nama,
		COALESCE(u_kecil.nama, u_besar.nama) AS satuan,
		b.warehouse_id, w.name AS warehouse_nama, b.branch_id, br.name AS branch_nama,
		b.batch_number, b.expiry_date::text AS expiry_date,
		(b.expiry_date - `+todayParam+`::date)::int AS days_left,
		b.qty_remaining::float8 AS qty_remaining,
		COALESCE(inv.unit_cost, b.unit_cost)::float8 AS avg_cost,
		(b.qty_remaining * COALESCE(inv.unit_cost, b.unit_cost))::float8 AS value_at_risk,
		b.source_type, b.received_at::text AS received_at
		FROM inventory.stock_batches b
		JOIN inventory.inventory inv ON inv.id = b.inventory_id
		JOIN item.raw_materials rm ON rm.id = b.raw_material_id
		LEFT JOIN item.units u_kecil ON u_kecil.id = rm.satuan_kecil_id
		LEFT JOIN item.units u_besar ON u_besar.id = rm.satuan_besar_id
		LEFT JOIN configuration.warehouses w ON w.id = b.warehouse_id
		LEFT JOIN configuration.branches br ON br.id = b.branch_id
		WHERE `+strings.Join(where, " AND ")+`
		ORDER BY b.expiry_date ASC, rm.nama ASC
		LIMIT 1000`, a.Values...)
	if err != nil {
		return err
	}
	batches := make([]domain.ExpiryBatch, len(rows))
	for i, row := range rows {
		batches[i] = domain.ExpiryBatch{ExpiryDate: row.StrPtr("expiry_date"), QtyRemaining: row.Num("qty_remaining"), ValueCost: row.Num("avg_cost")}
	}
	type expiryMeta struct {
		Today   string `json:"today"`
		Horizon string `json:"horizon"`
	}
	return kit.OK(w, struct {
		Success bool                 `json:"success"`
		Data    kit.Rows             `json:"data"`
		Summary domain.ExpirySummary `json:"summary"`
		Meta    expiryMeta           `json:"meta"`
	}{true, rows, domain.SummarizeExpiry(batches, today, days), expiryMeta{today, horizon}})
}

/* GET /api/inventory/materials — active materials in the caller's company/branch. */
func (h *handler) materials(w http.ResponseWriter, r *http.Request) error {
	_, scope, err := h.staffScope(r, h.inventoryStaff)
	if err != nil {
		return err
	}
	var companyID, branchID *string
	if scope != nil && !scope.Unscoped {
		if scope.Level() != "holding" {
			companyID = scope.CompanyID
		}
		if scope.Level() == "branch" {
			branchID = scope.BranchID
		}
	}
	rows, err := kit.Query(r.Context(), h.env.DB, `SELECT rm.id, rm.kode, rm.nama, COALESCE(u_kecil.nama, u_besar.nama) AS satuan
		FROM item.raw_materials rm
		LEFT JOIN item.units u_kecil ON u_kecil.id = rm.satuan_kecil_id
		LEFT JOIN item.units u_besar ON u_besar.id = rm.satuan_besar_id
		WHERE rm.is_active = true AND rm.deleted_at IS NULL
		  AND ($1::uuid IS NULL OR rm.company_id = $1)
		  AND ($2::uuid IS NULL OR rm.branch_id = $2)
		ORDER BY rm.nama
		LIMIT 2000`, companyID, branchID)
	if err != nil {
		return err
	}
	return kit.Data(w, rows)
}

/* GET /api/inventory/low-stock — below minimum, with a reorder suggestion. */
func (h *handler) lowStock(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.inventoryStaff(r); err != nil {
		return err
	}
	sp := r.URL.Query()
	rows, err := kit.Query(r.Context(), h.env.DB, `WITH levels AS (
		SELECT inv.id, inv.raw_material_id, rm.kode AS material_kode, rm.nama AS material_nama,
		       rm.kategori AS material_kategori,
		       inv.qty_available::float8 AS qty_available,
		       inv.qty_on_order::float8 AS qty_on_order,
		       COALESCE(rm.stok_minimum, inv.qty_minimum, 1000)::float8 AS qty_minimum,
		       COALESCE(NULLIF(inv.qty_maximum, 0), NULLIF(rm.stok_maximum, 0))::float8 AS qty_maximum,
		       COALESCE(inv.unit_cost, 0)::float8 AS unit_cost,
		       COALESCE(u_kecil.nama, u_besar.nama) AS satuan, w.name AS warehouse_nama
		  FROM inventory.inventory inv
		  JOIN item.raw_materials rm ON rm.id = inv.raw_material_id
		  LEFT JOIN item.units u_kecil ON u_kecil.id = rm.satuan_kecil_id
		  LEFT JOIN item.units u_besar ON u_besar.id = rm.satuan_besar_id
		  LEFT JOIN configuration.warehouses w ON w.id = inv.warehouse_id
		 WHERE inv.is_active = true
		   AND ($1::text = '' OR $1 = 'all' OR rm.kategori = $1)
		)
		SELECT l.*, CASE WHEN l.qty_available <= 0 THEN 'out_of_stock' ELSE 'low_stock' END AS stock_status
		  FROM levels l
		 WHERE l.qty_available <= l.qty_minimum
		   AND ($2::text = '' OR ($2 = 'out_of_stock' AND l.qty_available <= 0)
		        OR ($2 = 'low_stock' AND l.qty_available > 0))
		 ORDER BY l.qty_available ASC`, sp.Get("category"), sp.Get("status"))
	if err != nil {
		return err
	}
	ids := make([]string, len(rows))
	for i, row := range rows {
		ids[i] = row.Str("raw_material_id")
	}
	last := map[string]LastPurchase{}
	if len(ids) > 0 {
		if last, err = h.ports.Procurement.LastPurchases(r.Context(), h.env.DB, ids); err != nil {
			return err
		}
	}
	items := make(kit.Rows, len(rows))
	for i, row := range rows {
		lp := last[row.Str("raw_material_id")]
		items[i] = lowStockItem(row, lp)
	}
	n := float64(len(items))
	return kit.Paginated(w, items, kit.Pagination{Page: 1, Limit: kit.Float(n), Total: len(items)}, "Low stock report retrieved")
}

// lowStockItem is toLowStockItem; supplier_name and last_purchase_date are
// left out when null (`?? undefined`).
func lowStockItem(row *kit.Row, lp LastPurchase) *kit.Row {
	s := domain.SuggestReorder(domain.StockLevel{
		OnHand: row.Num("qty_available"), OnOrder: row.Num("qty_on_order"),
		Minimum: row.Num("qty_minimum"), Maximum: row.NumPtr("qty_maximum"),
	})
	out := kit.Obj(
		"id", row.Get("id"),
		"raw_material_id", row.Get("raw_material_id"),
		"material_kode", row.Get("material_kode"),
		"material_nama", row.Get("material_nama"),
		"kategori", row.Get("material_kategori"),
		"qty_available", row.Get("qty_available"),
		"qty_on_order", row.Get("qty_on_order"),
		"qty_minimum", row.Get("qty_minimum"),
		"qty_maximum", row.Get("qty_maximum"),
		"unit_cost", row.Get("unit_cost"),
		"satuan", row.Get("satuan"),
		"warehouse_nama", row.Get("warehouse_nama"),
		"stock_status", row.Get("stock_status"),
		"shortage_qty", s.Shortage,
		"suggested_order_qty", s.SuggestedQty,
		"suggestion_basis", s.Basis,
		"estimated_cost", s.SuggestedQty*row.Num("unit_cost"),
		"supplier_id", lp.SupplierID,
	)
	if lp.SupplierName != nil {
		out.Set("supplier_name", *lp.SupplierName)
	}
	if lp.TanggalPO != nil {
		out.Set("last_purchase_date", *lp.TanggalPO)
	}
	return out
}

/* ── raw material stock by stall (warehouse-stock.ts) ────────────────── */

// stockRow is RawMaterialStockRow after mapQueryRow.
type stockRow struct {
	RawMaterialID   string
	InventoryID     *string
	Kode, Nama      string
	Kategori        *string
	Satuan          *string
	SatuanBesarNama *string
	SatuanKecilNama *string
	KonversiFactor  *float64
	HargaBeli       *float64
	QtyOnhand       float64
	MinStock        float64
	MaxStock        *float64
	UnitCost        float64
	WarehouseID     *string
	WarehouseNama   *string
}

func toStockRows(rows kit.Rows) []stockRow {
	out := make([]stockRow, len(rows))
	for i, r := range rows {
		out[i] = stockRow{
			RawMaterialID: r.Str("raw_material_id"), InventoryID: r.StrPtr("inventory_id"),
			Kode: r.Str("material_kode"), Nama: r.Str("material_nama"), Kategori: r.StrPtr("material_kategori"),
			Satuan: r.StrPtr("satuan"), SatuanBesarNama: r.StrPtr("satuan_besar_nama"), SatuanKecilNama: r.StrPtr("satuan_kecil_nama"),
			KonversiFactor: r.NumPtr("konversi_factor"), HargaBeli: r.NumPtr("harga_beli"),
			QtyOnhand: r.Num("qty_onhand"), MinStock: r.Num("min_stock"), MaxStock: r.NumPtr("max_stock"),
			UnitCost: r.Num("unit_cost"), WarehouseID: r.StrPtr("warehouse_id"), WarehouseNama: r.StrPtr("warehouse_nama"),
		}
	}
	return out
}

// stockByWarehouse is listRawMaterialStockByWarehouse: every active
// material of the warehouse's branch with its quantity there.
func (h *handler) stockByWarehouse(r *http.Request, warehouseID string) ([]stockRow, error) {
	ctx := r.Context()
	wh, err := kit.QueryOne(ctx, h.env.DB, `SELECT branch_id::text AS branch_id, name AS warehouse_nama
		FROM configuration.warehouses WHERE id = $1 AND is_active = true`, warehouseID)
	if err != nil || wh == nil || wh.Str("branch_id") == "" {
		return nil, err
	}
	rows, err := kit.Query(ctx, h.env.DB, `SELECT inv.id AS inventory_id,
		rm.id AS raw_material_id, rm.kode AS material_kode, rm.nama AS material_nama, rm.kategori AS material_kategori,
		u_besar.nama AS satuan, u_besar.nama AS satuan_besar_nama, u_kecil.nama AS satuan_kecil_nama,
		rm.konversi_factor, rm.harga_beli,
		COALESCE(inv.qty_available, 0) AS qty_onhand,
		COALESCE(rm.stok_minimum, inv.qty_minimum, 0) AS min_stock,
		COALESCE(rm.stok_maximum, inv.qty_maximum) AS max_stock,
		COALESCE(inv.unit_cost, rm.harga_beli, 0) AS unit_cost,
		$1::uuid AS warehouse_id, $3::text AS warehouse_nama
		FROM raw_materials rm
		LEFT JOIN units u_besar ON u_besar.id = rm.satuan_besar_id
		LEFT JOIN units u_kecil ON u_kecil.id = rm.satuan_kecil_id
		LEFT JOIN inventory inv ON inv.raw_material_id = rm.id AND inv.warehouse_id = $1 AND inv.is_active = true
		WHERE rm.deleted_at IS NULL AND rm.is_active = true AND rm.branch_id = $2
		ORDER BY rm.nama ASC`, warehouseID, wh.Str("branch_id"), wh.Str("warehouse_nama"))
	if err != nil {
		return nil, err
	}
	return toStockRows(rows), nil
}

// stockByBranch is listRawMaterialStockByBranch: quantities summed over the
// branch's active warehouses at their weighted cost.
func (h *handler) stockByBranch(r *http.Request, branchID string) ([]stockRow, error) {
	rows, err := kit.Query(r.Context(), h.env.DB, `SELECT NULL::uuid AS inventory_id,
		rm.id AS raw_material_id, rm.kode AS material_kode, rm.nama AS material_nama, rm.kategori AS material_kategori,
		u_besar.nama AS satuan, u_besar.nama AS satuan_besar_nama, u_kecil.nama AS satuan_kecil_nama,
		rm.konversi_factor, rm.harga_beli,
		COALESCE(SUM(inv.qty_available), 0) AS qty_onhand,
		COALESCE(rm.stok_minimum, 0) AS min_stock,
		rm.stok_maximum AS max_stock,
		CASE WHEN COALESCE(SUM(inv.qty_available), 0) > 0
		       THEN SUM(inv.qty_available * COALESCE(inv.unit_cost, 0)) / SUM(inv.qty_available)
		     ELSE COALESCE(AVG(inv.unit_cost), rm.harga_beli, 0)
		END AS unit_cost,
		NULL::uuid AS warehouse_id, NULL::text AS warehouse_nama
		FROM raw_materials rm
		LEFT JOIN units u_besar ON u_besar.id = rm.satuan_besar_id
		LEFT JOIN units u_kecil ON u_kecil.id = rm.satuan_kecil_id
		LEFT JOIN inventory inv ON inv.raw_material_id = rm.id AND inv.is_active = true
		  AND inv.warehouse_id IN (SELECT w.id FROM configuration.warehouses w WHERE w.branch_id = $1 AND w.is_active = true)
		WHERE rm.deleted_at IS NULL AND rm.is_active = true AND rm.branch_id = $1
		GROUP BY rm.id, rm.kode, rm.nama, rm.kategori, rm.konversi_factor, rm.harga_beli, rm.stok_minimum, rm.stok_maximum,
		         u_besar.nama, u_kecil.nama
		ORDER BY rm.nama ASC`, branchID)
	if err != nil {
		return nil, err
	}
	return toStockRows(rows), nil
}

// filterStockRows is filterStockRows (search on nama/kode, status bucket).
func filterStockRows(rows []stockRow, search, status string) []stockRow {
	q := strings.ToLower(strings.TrimSpace(search))
	out := make([]stockRow, 0, len(rows))
	for _, row := range rows {
		if q != "" && !strings.Contains(strings.ToLower(row.Nama), q) && !strings.Contains(strings.ToLower(row.Kode), q) {
			continue
		}
		st := domain.StockStatus(row.QtyOnhand, row.MinStock)
		switch status {
		case "out_of_stock":
			if row.QtyOnhand > 0 {
				continue
			}
		case "low_stock":
			if !(row.QtyOnhand > 0 && st == "MENIPIS") {
				continue
			}
		case "normal":
			if st != "AMAN" {
				continue
			}
		}
		out = append(out, row)
	}
	return out
}

// orStr is `a || b || null` on nullable strings.
func orStr(vals ...*string) *string {
	for _, v := range vals {
		if v != nil && *v != "" {
			return v
		}
	}
	return nil
}

// mapStockRow is mapRawMaterialStockRow.
func mapStockRow(row stockRow) *kit.Row {
	return kit.Obj(
		"id", row.RawMaterialID,
		"kode", row.Kode,
		"nama", row.Nama,
		"kategori", row.Kategori,
		"qty_onhand", row.QtyOnhand,
		"min_stock", row.MinStock,
		"max_stock", row.MaxStock,
		"unit_cost", row.UnitCost,
		"avg_cost", row.UnitCost,
		"total_value", row.QtyOnhand*row.UnitCost,
		"status_stok", domain.StockStatus(row.QtyOnhand, row.MinStock),
		"satuan", orStr(row.Satuan, row.SatuanBesarNama),
		"satuan_besar_nama", orStr(row.SatuanBesarNama, row.Satuan),
		"satuan_kecil_nama", row.SatuanKecilNama,
		"konversi_factor", row.KonversiFactor,
		"harga_beli", row.HargaBeli,
		"warehouse_id", row.WarehouseID,
		"warehouse_nama", row.WarehouseNama,
	)
}

var legacyStockStatus = map[string]string{"out_of_stock": "HABIS", "low_stock": "MENIPIS", "normal": "AMAN"}

/*
GET /api/inventory/raw-materials — material stock at the active stall,

	the caller's branch, or (neither) the legacy aggregate view.
*/
func (h *handler) rawMaterialStock(w http.ResponseWriter, r *http.Request) error {
	u, scope, err := h.staffScope(r, h.inventoryStaff)
	if err != nil {
		return err
	}
	f := kit.FromRequest(r)
	search := f.Str("search", validate.Rule{Optional: true}, validate.StrOpts{})
	status := f.Str("status", validate.Rule{Optional: true}, validate.StrOpts{})
	page := f.Coerce("page", kit.Ptr(1.0), validate.NumOpts{Min: validate.Bound(1)})
	limit := f.Coerce("limit", kit.Ptr(20.0), validate.NumOpts{Min: validate.Bound(1), Max: validate.Bound(100)})
	warehouseParam := f.UUID("warehouse_id", validate.Rule{Optional: true})
	if err := f.FlattenErr("Filter tidak valid"); err != nil {
		return err
	}
	ctx := r.Context()
	explicit := ""
	if warehouseParam != nil {
		explicit = *warehouseParam
	}
	warehouseID, err := kit.ResolveWarehouseFilter(ctx, h.env.DB, r, u.ID, explicit)
	if err != nil {
		return err
	}
	branchID := kit.Deref(ps.BranchFilter(scope))
	searchS, statusS := kit.Deref(search), kit.Deref(status)
	const message = "Raw material stock retrieved"
	meta := func(total int) kit.Pagination {
		return kit.Pagination{Page: kit.Float(*page), Limit: kit.Float(*limit), Total: total}
	}

	if warehouseID == "" && branchID == "" {
		a := &kit.Args{}
		where := []string{`"deleted_at" IS NULL`, `"is_active" = ` + a.Add(true)}
		if st, ok := legacyStockStatus[statusS]; ok {
			where = append(where, `"status_stok" = `+a.Add(st))
		}
		if c := kit.Deref(ps.CompanyFilter(scope)); c != "" {
			where = append(where, `("company_id" = `+a.Add(c)+`)`)
		}
		if b := kit.Deref(ps.BranchFilter(scope)); b != "" {
			where = append(where, `("branch_id" = `+a.Add(b)+`)`)
		}
		if searchS != "" {
			where = append(where, kit.Search(a, "", searchS, "nama", "kode"))
		}
		rows, total, err := h.countAndList(r, `v_raw_materials_stock`, strings.Join(where, " AND "), a, `"nama" ASC`, *page, *limit)
		if err != nil {
			return err
		}
		return kit.Paginated(w, rows, meta(total), message)
	}

	var rows []stockRow
	if warehouseID != "" {
		_, werr, err := kit.ValidateWarehouse(ctx, h.env.DB, warehouseID, scope, nil)
		if err != nil {
			return err
		}
		if werr != "" {
			return httpx.BadRequest("Gudang tidak valid atau tidak diizinkan")
		}
		rows, err = h.stockByWarehouse(r, warehouseID)
		if err != nil {
			return err
		}
	} else if rows, err = h.stockByBranch(r, branchID); err != nil {
		return err
	}
	filtered := filterStockRows(rows, searchS, statusS)
	start, end := kit.SliceBounds(len(filtered), (*page-1)**limit, (*page-1)**limit+*limit)
	data := make(kit.Rows, 0, end-start)
	for _, row := range filtered[start:end] {
		data = append(data, mapStockRow(row))
	}
	return kit.Paginated(w, data, meta(len(filtered)), message)
}
