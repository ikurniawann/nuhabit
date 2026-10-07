package stock

import (
	"context"
	"errors"
	"net/http"
	ps "nuhabit/backend/internal/platform/scope"
	"sort"

	"nuhabit/backend/internal/modules/inventory/domain"
	"nuhabit/backend/internal/modules/inventory/kit"
	"nuhabit/backend/internal/modules/inventory/ledger"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/validate"
)

// Product (finished goods) opnames: frontend/src/lib/inventory/
// product-stock-opname.ts and product-stock-opname-service.ts.

const productOpnameNotFound = "Stock opname produk tidak ditemukan"

// productScopeFilter is buildProductScopeFilter / buildOpnameScopeFilter:
// branch users see their branch, other scoped users their company.
func productScopeFilter(s *ps.Scope, alias string, a *kit.Args) string {
	if s == nil || s.Unscoped {
		return ""
	}
	if s.Level() == "branch" && kit.Deref(s.BranchID) != "" {
		return alias + ".branch_id = " + a.Add(kit.Deref(s.BranchID))
	}
	if kit.Deref(s.CompanyID) != "" {
		return alias + ".company_id = " + a.Add(kit.Deref(s.CompanyID))
	}
	return ""
}

// opnameInScope is isOpnameInScope.
func opnameInScope(s *ps.Scope, companyID, branchID string) bool {
	if s == nil || s.Unscoped {
		return true
	}
	if s.Level() == "branch" && kit.Deref(s.BranchID) != "" {
		return branchID == kit.Deref(s.BranchID)
	}
	if kit.Deref(s.CompanyID) != "" {
		return companyID == kit.Deref(s.CompanyID)
	}
	return true
}

// productOpnameLines is listProductInventoryForOpname: the stall's active
// products in scope with their stock, one line per active SKU for
// merchandise with variants.
func (h *handler) productOpnameLines(ctx context.Context, scope *ps.Scope, warehouseID string) ([]*kit.Row, error) {
	a := &kit.Args{}
	scopeSQL := productScopeFilter(scope, "p", a)
	if scopeSQL == "" {
		scopeSQL = "1=1"
	}
	rows, err := kit.Query(ctx, h.env.DB, `SELECT p.id AS product_id, fgi.id AS inventory_id, p.kode AS product_kode,
		p.nama AS product_nama, u.nama AS satuan,
		COALESCE(fgi.qty_available, 0) AS qty_system,
		COALESCE(NULLIF(fgi.unit_cost, 0), p.harga_modal, 0) AS unit_cost
		FROM products p
		LEFT JOIN inventory.finished_goods_inventory fgi ON fgi.product_id = p.id AND fgi.is_active = true
		LEFT JOIN units u ON u.id = p.satuan_id
		WHERE p.deleted_at IS NULL AND p.is_active = true AND p.warehouse_id = `+a.Add(warehouseID)+`
		  AND `+scopeSQL+`
		ORDER BY p.nama ASC`, a.Values...)
	if err != nil {
		return nil, err
	}
	ids := make([]string, len(rows))
	for i, r := range rows {
		ids[i] = r.Str("product_id")
	}
	skus := map[string][]Sku{}
	if len(ids) > 0 {
		if skus, err = h.ports.PosSkus.ActiveSkus(ctx, h.env.DB, ids); err != nil {
			return nil, err
		}
	}
	var out []*kit.Row
	for _, r := range rows {
		base := kit.Obj(
			"inventory_id", r.Get("inventory_id"), "product_id", r.Get("product_id"), "product_kode", r.Get("product_kode"),
			"product_nama", r.Get("product_nama"), "satuan", r.Get("satuan"), "qty_system", r.Num("qty_system"),
			"unit_cost", r.Num("unit_cost"),
		)
		variants := skus[r.Str("product_id")]
		if len(variants) == 0 {
			out = append(out, base)
			continue
		}
		for _, s := range variants {
			out = append(out, base.Clone().Set("pos_sku_id", s.ID).Set("pos_sku_code", s.Sku).Set("pos_sku_name", s.Name).
				Set("qty_system", s.StockQuantity))
		}
	}
	return out, nil
}

// fetchProductOpname is fetchProductStockOpnameDetail (nil when missing).
func (h *handler) fetchProductOpname(ctx context.Context, q database.Querier, id string) (*kit.Row, error) {
	header, err := kit.QueryOne(ctx, q, `SELECT pso.*, b.name AS branch_name, b.code AS branch_code,
		wh.name AS warehouse_name, wh.code AS warehouse_code
		FROM inventory.product_stock_opnames pso
		LEFT JOIN configuration.branches b ON b.id = pso.branch_id
		LEFT JOIN configuration.warehouses wh ON wh.id = pso.warehouse_id
		WHERE pso.id = $1`, id)
	if err != nil || header == nil {
		return nil, err
	}
	rows, err := kit.Query(ctx, q, `SELECT psol.*, p.kode AS product_kode, p.nama AS product_nama, u.nama AS satuan
		FROM inventory.product_stock_opname_lines psol
		JOIN products p ON p.id = psol.product_id
		LEFT JOIN units u ON u.id = p.satuan_id
		WHERE psol.product_stock_opname_id = $1
		ORDER BY p.nama ASC`, id)
	if err != nil {
		return nil, err
	}
	var skuIDs []string
	for _, l := range rows {
		if s := l.Str("pos_sku_id"); s != "" {
			skuIDs = append(skuIDs, s)
		}
	}
	labels := map[string]Sku{}
	if len(skuIDs) > 0 {
		if labels, err = h.ports.PosSkus.SkuLabels(ctx, q, skuIDs); err != nil {
			return nil, err
		}
	}
	// ORDER BY p.nama ASC, sk.sku ASC NULLS FIRST: the SKU code comes from
	// the POS port, so the tie-break on it runs here.
	skuCode := func(l *kit.Row) *string {
		if lb, ok := labels[l.Str("pos_sku_id")]; ok && l.Str("pos_sku_id") != "" {
			return &lb.Sku
		}
		return nil
	}
	for start := 0; start < len(rows); {
		end := start + 1
		for end < len(rows) && rows[end].Str("product_nama") == rows[start].Str("product_nama") {
			end++
		}
		run := rows[start:end]
		sort.SliceStable(run, func(i, j int) bool {
			a, b := skuCode(run[i]), skuCode(run[j])
			switch {
			case a == nil:
				return b != nil
			case b == nil:
				return false
			}
			return *a < *b
		})
		start = end
	}
	lines := make([]*kit.Row, len(rows))
	for i, l := range rows {
		var code, name any
		if lb, ok := labels[l.Str("pos_sku_id")]; ok && l.Str("pos_sku_id") != "" {
			code, name = lb.Sku, lb.Name
		}
		lines[i] = kit.Obj(
			"id", l.Get("id"), "product_stock_opname_id", l.Get("product_stock_opname_id"), "inventory_id", l.Get("inventory_id"),
			"product_id", l.Get("product_id"), "qty_system", l.Num("qty_system"), "qty_counted", numOrNil(l, "qty_counted"),
			"qty_variance", numOrNil(l, "qty_variance"), "unit_cost", l.Num("unit_cost"), "notes", l.Get("notes"),
			"product_kode", l.Get("product_kode"), "product_nama", l.Get("product_nama"), "satuan", l.Get("satuan"),
			"pos_sku_id", l.Get("pos_sku_id"), "pos_sku_code", code, "pos_sku_name", name,
		)
	}
	return productOpnameHeader(header, lines), nil
}

func productOpnameHeader(row *kit.Row, lines any) *kit.Row {
	return kit.Obj(
		"id", row.Get("id"), "opname_number", row.Get("opname_number"), "company_id", row.Get("company_id"),
		"branch_id", row.Get("branch_id"), "warehouse_id", row.Get("warehouse_id"), "opname_date", row.Get("opname_date"),
		"status", row.Get("status"), "reason", row.Get("reason"), "notes", row.Get("notes"),
		"total_lines", row.Get("total_lines"), "lines_counted", row.Get("lines_counted"),
		"lines_with_variance", row.Get("lines_with_variance"), "completed_at", row.Get("completed_at"),
		"created_at", row.Get("created_at"), "updated_at", row.Get("updated_at"),
		"branch", opnameRef(row, "branch_id", "branch_name", "branch_code"),
		"warehouse", opnameRef(row, "warehouse_id", "warehouse_name", "warehouse_code"),
		"lines", lines,
	)
}

// productOpnameInScope is getProductStockOpnameInScope (404 outside scope).
func (h *handler) productOpnameInScope(ctx context.Context, id string, scope *ps.Scope) (*kit.Row, error) {
	detail, err := h.fetchProductOpname(ctx, h.env.DB, id)
	if err != nil {
		return nil, err
	}
	if detail == nil || !opnameInScope(scope, detail.Str("company_id"), detail.Str("branch_id")) {
		return nil, httpx.NotFound(productOpnameNotFound)
	}
	return detail, nil
}

/* GET /api/inventory/product-stock-opnames */
func (h *handler) listProductOpnames(w http.ResponseWriter, r *http.Request) error {
	u, scope, err := h.staffScope(r, h.inventoryStaff)
	if err != nil {
		return err
	}
	p, err := parseOpnameListQuery(r)
	if err != nil {
		return err
	}
	ctx := r.Context()
	a := &kit.Args{}
	cond := []string{"1=1"}
	if p.status != "" && p.status != "all" {
		cond = append(cond, "pso.status = "+a.Add(p.status))
	}
	if p.reason != "" {
		cond = append(cond, "pso.reason = "+a.Add(p.reason))
	}
	if p.search != "" {
		s := a.Add("%" + p.search + "%")
		cond = append(cond, "(pso.opname_number ILIKE "+s+" OR pso.notes ILIKE "+s+")")
	}
	warehouse, err := kit.ResolveWarehouseFilter(ctx, h.env.DB, r, u.ID, p.warehouseID)
	if err != nil {
		return err
	}
	if warehouse != "" {
		cond = append(cond, "pso.warehouse_id = "+a.Add(warehouse))
	}
	if c := productScopeFilter(scope, "pso", a); c != "" {
		cond = append(cond, c)
	}
	where := joinAnd(cond)
	var total string
	if err := h.env.DB.QueryRow(ctx, `SELECT COUNT(*)::text AS total FROM inventory.product_stock_opnames pso WHERE `+where, a.Values...).Scan(&total); err != nil {
		return err
	}
	rows, err := kit.Query(ctx, h.env.DB, `SELECT pso.*, b.name AS branch_name, b.code AS branch_code,
		wh.name AS warehouse_name, wh.code AS warehouse_code
		FROM inventory.product_stock_opnames pso
		LEFT JOIN configuration.branches b ON b.id = pso.branch_id
		LEFT JOIN configuration.warehouses wh ON wh.id = pso.warehouse_id
		WHERE `+where+` ORDER BY pso.opname_date DESC, pso.created_at DESC
		LIMIT `+a.Add(kit.N(p.limit))+` OFFSET `+a.Add(kit.N((p.page-1)*p.limit)), a.Values...)
	if err != nil {
		return err
	}
	data := make([]*kit.Row, len(rows))
	for i, row := range rows {
		// The TS list row has no warehouse_id key (the detail has one).
		data[i] = productOpnameHeader(row, []any{})
		data[i].Delete("warehouse_id")
	}
	return kit.OK(w, struct {
		Success    bool             `json:"success"`
		Data       []*kit.Row       `json:"data"`
		Pagination opnamePagination `json:"pagination"`
	}{true, data, listPagination(p.page, p.limit, atoi(total))})
}

/* GET /api/inventory/product-stock-opnames/preview?warehouse_id= */
func (h *handler) productOpnamePreview(w http.ResponseWriter, r *http.Request) error {
	_, scope, err := h.staffScope(r, h.inventoryStaff)
	if err != nil {
		return err
	}
	f := kit.FromRequest(r)
	warehouse := f.Str("warehouse_id", validate.Rule{}, uuidMsg("Stall wajib dipilih"))
	if err := f.FlattenErr("Validasi gagal"); err != nil {
		return err
	}
	ctx := r.Context()
	if _, msg, err := kit.ValidateProductWarehouse(ctx, h.env.DB, *warehouse, scope); err != nil {
		return err
	} else if msg != "" {
		return httpx.BadRequest(msg)
	}
	lines, err := h.productOpnameLines(ctx, scope, *warehouse)
	if err != nil {
		return err
	}
	if lines == nil {
		lines = []*kit.Row{}
	}
	return kit.OK(w, struct {
		Success bool       `json:"success"`
		Data    []*kit.Row `json:"data"`
		Total   int        `json:"total"`
	}{true, lines, len(lines)})
}

/* POST /api/inventory/product-stock-opnames */
func (h *handler) createProductOpname(w http.ResponseWriter, r *http.Request) error {
	u, err := h.inventoryStaff(r)
	if err != nil {
		return err
	}
	in, err := parseOpnameCreate(r, "Stall wajib dipilih")
	if err != nil {
		return err
	}
	ctx := r.Context()
	scope, err := h.env.Scope(ctx, u)
	if err != nil {
		return err
	}
	ws, msg, err := kit.ValidateProductWarehouse(ctx, h.env.DB, in.warehouseID, scope)
	if err != nil {
		return err
	}
	if msg != "" {
		return httpx.BadRequest(msg)
	}
	lines, err := h.productOpnameLines(ctx, scope, in.warehouseID)
	if err != nil {
		return err
	}
	if len(lines) == 0 {
		return httpx.BadRequest("No active products found for this stall")
	}
	companyID, branchID := ws.CompanyID, ws.BranchID
	if c := ps.EffectiveCompanyID(scope); c != nil {
		companyID = *c
	}
	if b := ps.EffectiveBranchID(scope); b != nil {
		branchID = *b
	}
	now := h.env.Now()
	var id string
	err = h.env.Tx(ctx, func(q database.Querier) error {
		if err := q.QueryRow(ctx, `INSERT INTO product_stock_opnames (company_id, branch_id, warehouse_id, opname_date, status,
			reason, notes, total_lines, lines_counted, lines_with_variance, created_by, updated_by)
			VALUES ($1, $2, $3, $4, 'draft', $5, $6, $7, 0, 0, $8, $8) RETURNING id::text`,
			companyID, branchID, in.warehouseID, orDate(in.opnameDate, now), in.reason, kit.OrNil(in.notes), len(lines), u.ID).Scan(&id); err != nil {
			return err
		}
		for _, line := range lines {
			invID := line.Str("inventory_id")
			if invID == "" {
				if invID, err = ledger.EnsureProductInventoryID(ctx, q, line.Str("product_id"), line.Num("unit_cost"), &u.ID); err != nil {
					return err
				}
			}
			if _, err := q.Exec(ctx, `INSERT INTO product_stock_opname_lines (product_stock_opname_id, inventory_id, product_id,
				pos_sku_id, qty_system, qty_counted, qty_variance, unit_cost) VALUES ($1, $2, $3, $4, $5, NULL, NULL, $6)`,
				id, invID, line.Get("product_id"), line.Get("pos_sku_id"), kit.N(line.Num("qty_system")), kit.N(line.Num("unit_cost"))); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return err
	}
	detail, err := h.fetchProductOpname(ctx, h.env.DB, id)
	if err != nil {
		return err
	}
	return kit.OK(w, kit.Obj("success", true, "data", detail, "message", "Sesi stock opname produk berhasil dibuat"))
}

/* GET /api/inventory/product-stock-opnames/{id} */
func (h *handler) getProductOpname(w http.ResponseWriter, r *http.Request) error {
	_, scope, err := h.staffScope(r, h.inventoryStaff)
	if err != nil {
		return err
	}
	detail, err := h.productOpnameInScope(r.Context(), r.PathValue("id"), scope)
	if err != nil {
		return err
	}
	return kit.Data(w, detail)
}

/* PATCH /api/inventory/product-stock-opnames/{id} */
func (h *handler) patchProductOpname(w http.ResponseWriter, r *http.Request) error {
	u, err := h.inventoryStaff(r)
	if err != nil {
		return err
	}
	in, err := parseOpnamePatch(r)
	if err != nil {
		return err
	}
	ctx := r.Context()
	scope, err := h.env.Scope(ctx, u)
	if err != nil {
		return err
	}
	id := r.PathValue("id")
	detail, err := h.productOpnameInScope(ctx, id, scope)
	if err != nil {
		return err
	}
	load := func() (*opnameState, error) {
		d, err := h.fetchProductOpname(ctx, h.env.DB, id)
		if err != nil || d == nil {
			return nil, err
		}
		st := opnameStateOf(d)
		return &st, nil
	}
	cancelled, err := applyOpnameChanges(ctx, h.env.DB, "product_stock_opnames", "product_stock_opname_lines", id, u.ID, in,
		opnameStateOf(detail), load, h.env.Now())
	if err != nil {
		return err
	}
	data, err := h.fetchProductOpname(ctx, h.env.DB, id)
	if err != nil {
		return err
	}
	msg := "Perubahan stock opname produk disimpan"
	if cancelled {
		msg = "Stock opname produk dibatalkan"
	}
	return kit.OK(w, kit.Obj("success", true, "data", data, "message", msg))
}

// opnameDelta is a summarizeOpnameSkuDeltas line.
type opnameDelta struct {
	lineID, productID, skuID string
	before, after, delta     float64
}

// summarizeSkuDeltas is summarizeOpnameSkuDeltas: SKU lines, product
// lines, and the non-zero Σ delta per variant product (in first-seen order).
func summarizeSkuDeltas(lines []opnameDelta) (skuLines, productLines []opnameDelta, productDeltas []opnameDelta, err error) {
	variant := map[string]bool{}
	for _, l := range lines {
		if l.skuID != "" {
			variant[l.productID] = true
		}
	}
	for _, l := range lines {
		if l.skuID == "" && variant[l.productID] {
			return nil, nil, nil, errors.New("Produk " + l.productID + " punya baris SKU dan baris level produk sekaligus dalam satu opname")
		}
	}
	sum := map[string]float64{}
	var order []string
	for _, l := range lines {
		l.delta = l.after - l.before
		if l.skuID == "" {
			productLines = append(productLines, l)
			continue
		}
		skuLines = append(skuLines, l)
		if _, ok := sum[l.productID]; !ok {
			order = append(order, l.productID)
		}
		sum[l.productID] += l.delta
	}
	for _, p := range order {
		if sum[p] != 0 {
			productDeltas = append(productDeltas, opnameDelta{productID: p, delta: sum[p]})
		}
	}
	return skuLines, productLines, productDeltas, nil
}

/*
POST /api/inventory/product-stock-opnames/{id}/complete — set SKU stock

	per variant line, product stock by Σ variant delta or per plain line.
*/
func (h *handler) completeProductOpname(w http.ResponseWriter, r *http.Request) error {
	u, err := h.inventoryStaff(r)
	if err != nil {
		return err
	}
	ctx := r.Context()
	scope, err := h.env.Scope(ctx, u)
	if err != nil {
		return err
	}
	id := r.PathValue("id")
	detail, err := h.productOpnameInScope(ctx, id, scope)
	if err != nil {
		return err
	}
	lines := detailLines(detail)
	if err := domain.AssertOpnameCompletable(detail.Str("status"), countedFlags(lines)); err != nil {
		return httpx.BadRequest(err.Error())
	}
	now := h.env.Now()
	number := detail.Str("opname_number")
	if number == "" {
		number = id
	}
	warehouseID := detail.StrPtr("warehouse_id")
	lineByID := map[string]*kit.Row{}
	invByProduct := map[string]string{}
	for _, l := range lines {
		lineByID[l.Str("id")] = l
		invByProduct[l.Str("product_id")] = l.Str("inventory_id")
	}
	movement := func(q database.Querier, invID, productID string, before, after, unitCost float64, alasan string, catatan, skuID *string) error {
		_, err := ledger.RecordFinishedGoodsMovement(ctx, q, ledger.FinishedGoodsMovement{
			InventoryID: invID, ProductID: productID, Tipe: "adjustment", QtyBefore: before, QtyAfter: after, UnitCost: unitCost,
			ReferenceType: kit.Ptr("product_stock_opname"), ReferenceID: &id, ReferenceNumber: &number,
			Alasan: &alasan, Catatan: catatan, UserID: &u.ID, WarehouseID: warehouseID, PosSkuID: skuID,
		}, now)
		return err
	}
	lockFG := func(q database.Querier, invID string) (*kit.Row, error) {
		inv, err := kit.QueryOne(ctx, q, `SELECT id::text, qty_available, unit_cost FROM inventory.finished_goods_inventory
			WHERE id = $1 FOR UPDATE`, invID)
		if err == nil && inv == nil {
			err = errors.New("Stok produk " + invID + " tidak ditemukan")
		}
		return inv, err
	}
	setFG := func(q database.Querier, invID string, qty float64) error {
		_, err := q.Exec(ctx, `UPDATE inventory.finished_goods_inventory SET qty_available = $1, last_movement_at = now(),
			updated_at = now(), updated_by = $2 WHERE id = $3`, kit.N(qty), u.ID, invID)
		return err
	}

	err = h.env.Tx(ctx, func(q database.Querier) error {
		inputs := make([]opnameDelta, len(lines))
		for i, l := range lines {
			in := opnameDelta{lineID: l.Str("id"), productID: l.Str("product_id"), skuID: l.Str("pos_sku_id"),
				before: l.Num("qty_system"), after: l.Num("qty_counted")}
			if in.skuID != "" {
				qty, ok, err := h.ports.PosSkus.LockSkuStock(ctx, q, in.skuID)
				if err != nil {
					return err
				}
				if !ok {
					return errors.New("SKU " + in.skuID + " tidak ditemukan")
				}
				in.before = qty
			}
			inputs[i] = in
		}
		skuLines, productLines, productDeltas, err := summarizeSkuDeltas(inputs)
		if err != nil {
			return httpx.BadRequest(err.Error())
		}
		for _, l := range skuLines {
			if l.delta == 0 {
				continue
			}
			line := lineByID[l.lineID]
			if err := h.ports.PosSkus.SetSkuStock(ctx, q, l.skuID, l.after); err != nil {
				return err
			}
			if err := movement(q, line.Str("inventory_id"), l.productID, l.before, l.after, line.Num("unit_cost"),
				"Stock opname completed", kit.Ptr("opname per varian"), kit.Ptr(l.skuID)); err != nil {
				return err
			}
		}
		for _, d := range productDeltas {
			inv, err := lockFG(q, invByProduct[d.productID])
			if err != nil {
				return err
			}
			before := inv.Num("qty_available")
			if err := setFG(q, inv.Str("id"), before+d.delta); err != nil {
				return err
			}
			if err := movement(q, inv.Str("id"), d.productID, before, before+d.delta, inv.Num("unit_cost"),
				"Stock opname completed (Σ varian)", nil, nil); err != nil {
				return err
			}
		}
		for _, l := range productLines {
			if l.after == l.before {
				continue
			}
			invID := lineByID[l.lineID].Str("inventory_id")
			inv, err := lockFG(q, invID)
			if err != nil {
				return err
			}
			if err := setFG(q, invID, l.after); err != nil {
				return err
			}
			if err := movement(q, invID, l.productID, l.before, l.after, inv.Num("unit_cost"), "Stock opname completed", nil, nil); err != nil {
				return err
			}
		}
		withVariance := 0
		for _, l := range lines {
			if l.Num("qty_variance") != 0 {
				withVariance++
			}
		}
		tag, err := q.Exec(ctx, `UPDATE inventory.product_stock_opnames SET status = 'completed', completed_at = now(),
			lines_counted = $2, lines_with_variance = $3, updated_by = $4, updated_at = now()
			WHERE id = $1 AND status <> 'completed'`, id, len(lines), withVariance, u.ID)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return httpx.BadRequest("Stock opname sudah diselesaikan sebelumnya")
		}
		return nil
	})
	if err != nil {
		return err
	}
	data, err := h.fetchProductOpname(ctx, h.env.DB, id)
	if err != nil {
		return err
	}
	return kit.OK(w, kit.Obj("success", true, "data", data, "message", "Stock opname produk selesai dan stok telah disesuaikan"))
}
