package stock

import (
	"encoding/json"
	"net/http"
	ps "nuhabit/backend/internal/platform/scope"
	"strings"

	"nuhabit/backend/internal/modules/inventory/kit"
	"nuhabit/backend/internal/modules/inventory/ledger"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/validate"
)

/*
GET /api/inventory/finished-goods — v_finished_goods_stock with the

	merchandise SKU variants of each product on the page.
*/
func (h *handler) finishedGoods(w http.ResponseWriter, r *http.Request) error {
	u, scope, err := h.staffScope(r, h.inventoryStaff)
	if err != nil {
		return err
	}
	ctx := r.Context()
	sp := r.URL.Query()
	warehouseID := sp.Get("warehouse_id")
	if warehouseID != "all" {
		if warehouseID, err = kit.ResolveWarehouseFilter(ctx, h.env.DB, r, u.ID, warehouseID); err != nil {
			return err
		}
	}
	page, limit := kit.NumberParam(sp, "page", 1), kit.NumberParam(sp, "limit", 20)
	search, status := sp.Get("search"), sp.Get("status")

	a := &kit.Args{}
	var where []string
	switch status {
	case "out_of_stock":
		where = append(where, `"qty_available" <= `+a.Add(0))
	case "in_stock":
		where = append(where, `"qty_available" > `+a.Add(0))
	}
	if warehouseID != "" && warehouseID != "all" {
		where = append(where, `"warehouse_id" = `+a.Add(warehouseID))
	}
	if c := kit.Deref(ps.CompanyFilter(scope)); c != "" {
		where = append(where, `("company_id" = `+a.Add(c)+`)`)
	}
	if b := kit.Deref(ps.BranchFilter(scope)); b != "" {
		where = append(where, `("branch_id" = `+a.Add(b)+`)`)
	}
	if search != "" {
		where = append(where, kit.Search(a, "", search, "product_nama", "product_kode"))
	}
	rows, total, err := h.countAndList(r, `v_finished_goods_stock`, strings.Join(where, " AND "), a, `"product_nama" ASC`, page, limit)
	if err != nil {
		return err
	}

	var ids []string
	seen := map[string]bool{}
	for _, row := range rows {
		if id := row.Str("product_id"); id != "" && !seen[id] {
			seen[id] = true
			ids = append(ids, id)
		}
	}
	skus := map[string][]Sku{}
	if len(ids) > 0 {
		if skus, err = h.ports.PosSkus.ActiveSkus(ctx, h.env.DB, ids); err != nil {
			return err
		}
	}
	for _, row := range rows {
		variants := []*kit.Row{}
		for _, s := range skus[row.Str("product_id")] {
			var options any
			if s.Options != nil {
				options = json.RawMessage(s.Options)
			}
			variants = append(variants, kit.Obj("sku_id", s.ID, "sku", s.Sku, "name", s.Name, "options", options, "stock_quantity", s.StockQuantity))
		}
		row.Set("variants", variants).Set("variant_count", len(variants))
	}
	return kit.Paginated(w, rows, kit.Pagination{Page: kit.Float(page), Limit: kit.Float(limit), Total: total}, "Finished goods stock retrieved")
}

/*
POST /api/inventory/finished-goods/adjustment — set a product's stock to

	the counted quantity.
*/
func (h *handler) adjustFinishedGoods(w http.ResponseWriter, r *http.Request) error {
	u, err := h.inventoryStaff(r)
	if err != nil {
		return err
	}
	f := validate.New(validate.ReadBody(r))
	productID := f.Str("product_id", validate.Rule{}, uuidMsg("Produk wajib dipilih"))
	qtyActual := kit.NumCheck(f, "qty_actual", validate.Rule{}, kit.Min(0, "Stok aktual minimal 0"))
	notes := f.Str("notes", validate.Rule{Optional: true}, validate.StrOpts{})
	if err := f.Err("Validation failed"); err != nil {
		return err
	}
	ctx := r.Context()
	scope, err := h.env.Scope(ctx, u)
	if err != nil {
		return err
	}
	now := h.env.Now()
	db := h.env.DB

	product, err := kit.QueryOne(ctx, db, `SELECT id, company_id::text, branch_id::text, harga_modal, kode, nama
		FROM products WHERE id = $1 AND deleted_at IS NULL AND is_active = true`, *productID)
	if err != nil {
		return err
	}
	if product == nil {
		return httpx.NotFound("Produk tidak ditemukan")
	}
	if !ps.RowInScope(scope, product.StrPtr("company_id"), product.StrPtr("branch_id")) {
		return httpx.Forbidden("Produk tidak tersedia untuk scope Anda")
	}
	unitCost := product.Num("harga_modal")
	invID, err := ledger.EnsureProductInventoryID(ctx, db, *productID, unitCost, &u.ID)
	if err != nil {
		return err
	}
	current, err := kit.QueryOne(ctx, db, `SELECT id, qty_available, unit_cost FROM inventory.finished_goods_inventory
		WHERE id = $1 AND is_active = true`, invID)
	if err != nil {
		return err
	}
	if current == nil {
		return httpx.NotFound("Data stok produk tidak ditemukan")
	}
	qtyBefore := current.Num("qty_available")
	updated, err := kit.QueryOne(ctx, db, `UPDATE finished_goods_inventory SET qty_available = $1, last_movement_at = $2,
		updated_at = $2, updated_by = $3 WHERE id = $4 RETURNING *`, kit.N(*qtyActual), now, u.ID, invID)
	if err != nil {
		return err
	}
	if updated == nil {
		return httpx.NotFound("Data stok produk tidak ditemukan")
	}
	movementCost := current.Num("unit_cost")
	if movementCost == 0 {
		movementCost = unitCost
	}
	if _, err := ledger.RecordFinishedGoodsMovement(ctx, db, ledger.FinishedGoodsMovement{
		InventoryID: invID, ProductID: *productID, Tipe: "adjustment", QtyBefore: qtyBefore, QtyAfter: *qtyActual,
		UnitCost: movementCost, ReferenceType: kit.Ptr("manual_adjustment"), ReferenceNumber: kit.Ptr(product.Str("kode")),
		Alasan: kit.Ptr("Manual stock adjustment"), Catatan: notes, UserID: &u.ID,
	}, now); err != nil {
		return err
	}
	diff := *qtyActual - qtyBefore
	message := "Stok produk berhasil disesuaikan"
	if diff == 0 {
		message = "Stok tidak berubah"
	}
	return kit.OK(w, kit.Obj(
		"success", true,
		"data", updated,
		"adjustment", kit.Obj(
			"product_id", *productID,
			"product_kode", product.Get("kode"),
			"product_nama", product.Get("nama"),
			"qty_before", qtyBefore,
			"qty_after", *qtyActual,
			"qty_diff", diff,
			"notes", notes,
		),
		"message", message,
	))
}
