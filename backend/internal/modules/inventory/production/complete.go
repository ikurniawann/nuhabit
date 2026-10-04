package production

import (
	"context"
	"errors"
	"net/http"
	"time"

	"nuhabit/backend/internal/modules/inventory/domain"
	"nuhabit/backend/internal/modules/inventory/kit"
	"nuhabit/backend/internal/modules/inventory/ledger"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
)

// lib/purchasing/production-complete.ts.

// errNoRows is a `.single()` miss the TS rethrows as a plain error (500).
var errNoRows = errors.New("No rows found")

type consumption struct {
	row                                  *kit.Row
	qtyActual, wasteQty, unit, totalCost float64
}

type postedVariant struct {
	skuID         string
	before, after float64
}

// complete is completeProductionOrder. Validation (status, materials,
// variant split, stock) runs first; the stock moves, batch and order update
// share one transaction; the POS HPP sync runs after commit, as in TS.
func (h *handler) complete(w http.ResponseWriter, r *http.Request, order *kit.Row, userID string, in updateInput) error {
	if order.Str("status") != "IN_PROGRESS" {
		return httpx.BadRequest("Produksi harus IN_PROGRESS sebelum completed")
	}
	ctx := r.Context()
	db := h.env.DB
	orderID, number := order.Str("id"), order.Str("nomor_produksi")
	actualQty := order.Num("planned_qty")
	if in.actualQty != nil && *in.actualQty != 0 {
		actualQty = *in.actualQty
	}
	materials, err := kit.Query(ctx, db, `SELECT * FROM production_order_materials WHERE production_order_id = $1`, orderID)
	if err != nil {
		return err
	}
	if len(materials) == 0 {
		return httpx.BadRequest("Material produksi tidak ditemukan")
	}
	outputType := kit.FirstNonEmpty(order.Str("output_type"), "FINISHED_GOOD")

	// resolveVariantSplit: only finished goods of a product order.
	var posProductID string
	var variants []domain.VariantRow
	if order.Str("production_context") == "product" && outputType == "FINISHED_GOOD" {
		pid, skus, err := h.merchandise(ctx, order.Str("product_id"))
		if err != nil {
			return err
		}
		posProductID = pid
		if len(skus) > 0 {
			ids := make([]string, len(skus))
			available := make([]*kit.Row, len(skus))
			for i, s := range skus {
				ids[i] = s.ID
				available[i] = kit.Obj("id", s.ID, "sku", s.Sku, "name", s.Name, "options", rawOrNil(s.Options))
			}
			rows := in.variants
			if !in.variantsSent {
				rows = nil
			}
			valid, msg := domain.ValidateVariantSplit(actualQty, rows, ids)
			if msg != "" {
				return httpx.BadRequest(msg, kit.Obj("available_skus", available))
			}
			variants = valid
		}
	}

	overrideQty := map[string]float64{}
	overrides := map[string]materialInput{}
	for _, m := range in.materials {
		overrideQty[m.id] = m.qty
		overrides[m.id] = m
	}
	_, shortages, err := h.checkStock(ctx, orderID, "actual", overrideQty)
	if err != nil {
		return err
	}
	if len(shortages) > 0 {
		return httpx.BadRequest("Stok bahan belum cukup untuk complete produksi", kit.Obj("shortages", shortages))
	}

	consumed := make([]consumption, len(materials))
	actualMaterialCost := 0.0
	for i, m := range materials {
		c := consumption{row: m, unit: m.Num("unit_cost")}
		if o, ok := overrides[m.Str("id")]; ok {
			c.qtyActual = o.qty
			if o.waste != nil && *o.waste != 0 {
				c.wasteQty = *o.waste
			} else {
				c.wasteQty = m.Num("waste_qty")
			}
		} else {
			c.qtyActual = kit.ToNum(jsOr(m.Get("qty_actual"), m.Get("qty_planned")))
			c.wasteQty = m.Num("waste_qty")
		}
		c.totalCost = c.qtyActual * c.unit
		consumed[i] = c
		actualMaterialCost += c.totalCost
	}
	cost := func(v *float64, key string) float64 {
		if v != nil {
			return *v
		}
		return order.Num(key)
	}
	overhead, labor := cost(in.overhead, "overhead_cost"), cost(in.labor, "labor_cost")
	packaging, waste := cost(in.packaging, "packaging_cost"), cost(in.waste, "waste_cost")
	totalCost := actualMaterialCost + overhead + labor + packaging + waste
	hpp := totalCost / actualQty
	now := h.env.Now()

	var updated, batch *kit.Row
	err = h.env.Tx(ctx, func(q database.Querier) error {
		if err := h.consume(ctx, q, orderID, number, userID, consumed, now); err != nil {
			return err
		}
		var wipID *string
		if product := embedded(order.Get("product")); outputType == "WIP" && product != nil {
			id, err := ensureWip(ctx, q, product, userID)
			if err != nil {
				return err
			}
			wipID = &id
		}
		if batch, err = upsertBatch(ctx, q, order, userID, outputType, wipID, actualQty, hpp, totalCost); err != nil {
			return err
		}
		switch {
		case order.Str("production_context") == "raw_material" && order.Str("output_raw_material_id") != "":
			err = ledger.AddFromProduction(ctx, q, ledger.ProductionOutput{RawMaterialID: order.Str("output_raw_material_id"),
				Qty: actualQty, UnitCost: hpp, OrderID: orderID, ProductionNumber: number, UserID: userID, ReferenceType: "production_output"}, now)
		case outputType == "WIP" && wipID != nil:
			err = ledger.AddFromProduction(ctx, q, ledger.ProductionOutput{RawMaterialID: *wipID, Qty: actualQty, UnitCost: hpp,
				OrderID: orderID, ProductionNumber: number, UserID: userID}, now)
		default:
			var posted []postedVariant
			if len(variants) > 0 && posProductID != "" {
				if posted, err = h.postVariants(ctx, q, orderID, batch.Str("id"), posProductID, userID, variants); err != nil {
					return err
				}
			}
			err = postFinishedGoods(ctx, q, order, userID, actualQty, hpp, totalCost, posted, now)
		}
		if err != nil {
			return err
		}
		rows, err := kit.Update(ctx, q, "production_orders", kit.Obj("status", "COMPLETED", "actual_qty", actualQty,
			"actual_material_cost", actualMaterialCost, "overhead_cost", overhead, "labor_cost", labor, "packaging_cost", packaging,
			"waste_cost", waste, "hpp_per_unit", hpp, "completed_at", now, "updated_by", userID, "updated_at", now),
			func(a *kit.Args) string { return `"id" = ` + a.Add(orderID) }, true)
		if err != nil {
			return err
		}
		if len(rows) == 0 {
			return errNoRows
		}
		updated = rows[0]
		return nil
	})
	if err != nil {
		return err
	}

	var sync any
	var margin *float64
	if order.Str("production_context") != "raw_material" && outputType == "FINISHED_GOOD" {
		res, err := h.ports.Pos.SyncHpp(ctx, db, order.Str("product_id"), hpp)
		if err != nil {
			return err // the TS route answers 500 after the stock already committed
		}
		if res != nil {
			sync = res
			m := res.Num("margin_percentage")
			margin = &m
		}
	}
	return kit.OK(w, kit.Obj("success", true, "data", kit.Obj("order", updated, "batch", batch, "pos_sync", sync),
		"message", domain.CompletionMessage(number, hpp, margin)))
}

// consume is consumeMaterials: stock out per material not yet consumed.
func (h *handler) consume(ctx context.Context, q database.Querier, orderID, number, userID string, materials []consumption, now time.Time) error {
	for _, m := range materials {
		fields := kit.Obj("qty_actual", m.qtyActual, "waste_qty", m.wasteQty, "unit_cost", m.unit, "total_cost", m.totalCost)
		id := m.row.Str("id")
		if m.row.Get("inventory_movement_id") == nil {
			rm := m.row.Str("raw_material_id")
			inv, err := kit.QueryOne(ctx, q, `SELECT id::text, qty_available, unit_cost, branch_id::text, warehouse_id::text
				FROM inventory WHERE raw_material_id = $1 AND is_active = true LIMIT 1`, rm)
			if err != nil || inv == nil {
				return httpx.BadRequest("Inventory bahan " + rm + " tidak ditemukan")
			}
			before := inv.Num("qty_available")
			if before < m.qtyActual {
				return httpx.BadRequest("Stok bahan tidak cukup. Sisa " + kit.JSNum(before) + ", butuh " + kit.JSNum(m.qtyActual))
			}
			after := before - m.qtyActual
			mv, err := kit.InsertOne(ctx, q, "inventory_movements", kit.Obj("inventory_id", inv.Get("id"), "raw_material_id", rm,
				"tipe", "out", "jumlah", m.qtyActual, "qty_before", before, "qty_after", after, "unit_cost", m.unit,
				"total_cost", m.totalCost, "branch_id", inv.Get("branch_id"), "warehouse_id", inv.Get("warehouse_id"),
				"reference_type", "production", "reference_id", orderID, "reference_number", number,
				"alasan", "Pemakaian bahan untuk produksi "+number, "created_by", userID))
			if err != nil {
				return err
			}
			if _, err := q.Exec(ctx, `UPDATE inventory SET qty_available = $1, last_movement_at = $2, updated_by = $3 WHERE id = $4`,
				kit.N(after), now, userID, inv.Get("id")); err != nil {
				return err
			}
			fields.Set("inventory_movement_id", mv.Get("id"))
		}
		if _, err := kit.Update(ctx, q, "production_order_materials", fields, func(a *kit.Args) string { return `"id" = ` + a.Add(id) }, false); err != nil {
			return err
		}
	}
	return nil
}

// ensureWip is ensureWipRawMaterial: the WIP material that mirrors a product.
func ensureWip(ctx context.Context, q database.Querier, product *kit.Row, userID string) (string, error) {
	existing, err := kit.QueryOne(ctx, q, `SELECT id::text FROM raw_materials WHERE source_product_id = $1 LIMIT 1`, product.Get("id"))
	if err != nil {
		return "", err
	}
	if existing != nil {
		return existing.Str("id"), nil
	}
	nama := kit.FirstNonEmpty(product.Str("nama"), product.Str("kode"), "WIP")
	var satuan any
	if s := product.Str("satuan_id"); s != "" {
		satuan = s
	}
	row, err := kit.InsertOne(ctx, q, "raw_materials", kit.Obj("kode", domain.WipCode(product.Str("kode")), "nama", nama,
		"kategori", "LAINNYA", "material_type", "WIP", "source_product_id", product.Get("id"), "satuan_besar_id", satuan,
		"satuan_kecil_id", satuan, "konversi_factor", 1.0, "created_by", userID))
	if err != nil {
		return "", err
	}
	return row.Str("id"), nil
}

// upsertBatch updates or creates the order's deterministic batch.
func upsertBatch(ctx context.Context, q database.Querier, order *kit.Row, userID, outputType string, wipID *string, qty, hpp, total float64) (*kit.Row, error) {
	number := domain.BatchNumber(order.Str("nomor_produksi"))
	existing, err := kit.QueryOne(ctx, q, `SELECT * FROM production_batches WHERE batch_number = $1 LIMIT 1`, number)
	if err != nil {
		return nil, err
	}
	values := kit.Obj("output_type", outputType, "wip_raw_material_id", wipID, "qty_produced", qty, "hpp_per_unit", hpp, "total_cost", total)
	var rows kit.Rows
	if existing != nil {
		rows, err = kit.Update(ctx, q, "production_batches", values, func(a *kit.Args) string { return `"id" = ` + a.Add(existing.Get("id")) }, true)
	} else {
		cols := kit.Obj("production_order_id", order.Get("id"), "product_id", order.Get("product_id"),
			"output_raw_material_id", order.Get("output_raw_material_id"), "batch_number", number)
		for _, k := range values.Keys() {
			cols.Set(k, values.Get(k))
		}
		rows, err = kit.Insert(ctx, q, "production_batches", []*kit.Row{cols.Set("created_by", userID)}, "", true)
	}
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return nil, errNoRows
	}
	return rows[0], nil
}

// postVariants is postVariantStock: idempotent per (batch, SKU) through ON
// CONFLICT DO NOTHING; only newly recorded rows raise SKU stock.
func (h *handler) postVariants(ctx context.Context, q database.Querier, orderID, batchID, posProductID, userID string, rows []domain.VariantRow) ([]postedVariant, error) {
	payload := make([]*kit.Row, len(rows))
	for i, r := range rows {
		payload[i] = kit.Obj("production_order_id", orderID, "production_batch_id", batchID, "pos_sku_id", r.PosSkuID, "qty", r.Qty, "created_by", userID)
	}
	inserted, err := insertIgnore(ctx, q, payload)
	if err != nil {
		return nil, err
	}
	var posted []postedVariant
	for _, row := range inserted {
		qty := row.Num("qty")
		after, ok, err := h.ports.Pos.AddSkuStock(ctx, q, row.Str("pos_sku_id"), posProductID, qty)
		if err != nil {
			return nil, err
		}
		if !ok {
			return nil, errors.New("SKU " + row.Str("pos_sku_id") + " tidak ditemukan untuk produk ini")
		}
		posted = append(posted, postedVariant{row.Str("pos_sku_id"), after - qty, after})
	}
	return posted, nil
}

// insertIgnore is `.upsert(rows).select("pos_sku_id, qty")` without a
// conflict target: ON CONFLICT DO NOTHING returning the inserted rows.
func insertIgnore(ctx context.Context, q database.Querier, rows []*kit.Row) (kit.Rows, error) {
	cols := rows[0].Keys()
	a := &kit.Args{}
	values := ""
	for i, r := range rows {
		if i > 0 {
			values += ", "
		}
		values += "("
		for j, c := range cols {
			if j > 0 {
				values += ", "
			}
			values += a.Add(kit.Param(r.Get(c)))
		}
		values += ")"
	}
	return kit.Query(ctx, q, `INSERT INTO production_output_variants (production_order_id, production_batch_id, pos_sku_id, qty, created_by)
		VALUES `+values+` ON CONFLICT DO NOTHING RETURNING pos_sku_id, qty`, a.Values...)
}

// postFinishedGoods adds the output to finished goods at the weighted cost
// and records the product movement plus one per posted variant.
func postFinishedGoods(ctx context.Context, q database.Querier, order *kit.Row, userID string, qty, hpp, total float64, posted []postedVariant, now time.Time) error {
	productID := order.Str("product_id")
	inv, err := kit.QueryOne(ctx, q, `SELECT id::text, qty_available, unit_cost FROM finished_goods_inventory WHERE product_id = $1 LIMIT 1`, productID)
	if err != nil {
		return err
	}
	var invID string
	before, after, unitCost := 0.0, qty, hpp
	if inv != nil {
		before = inv.Num("qty_available")
		after = before + qty
		if after > 0 {
			unitCost = (before*inv.Num("unit_cost") + total) / after
		}
		if _, err := q.Exec(ctx, `UPDATE finished_goods_inventory SET qty_available = $1, unit_cost = $2, last_movement_at = $3,
			updated_by = $4, updated_at = $3 WHERE id = $5`, kit.N(after), kit.N(unitCost), now, userID, inv.Get("id")); err != nil {
			return err
		}
		invID = inv.Str("id")
	} else {
		created, err := kit.InsertOne(ctx, q, "finished_goods_inventory", kit.Obj("product_id", productID, "qty_available", qty,
			"unit_cost", hpp, "last_movement_at", now, "created_by", userID))
		if err != nil {
			return err
		}
		invID = created.Str("id")
	}
	base := ledger.FinishedGoodsMovement{
		InventoryID: invID, ProductID: productID, Tipe: "in", UnitCost: unitCost, ReferenceType: kit.Ptr("production_order"),
		ReferenceID: kit.Ptr(order.Str("id")), ReferenceNumber: kit.Ptr(order.Str("nomor_produksi")),
		Alasan: kit.Ptr("Production completed"), UserID: &userID,
	}
	m := base
	m.QtyBefore, m.QtyAfter = before, after
	if _, err := ledger.RecordFinishedGoodsMovement(ctx, q, m, now); err != nil {
		return err
	}
	for _, p := range posted {
		v := base
		v.QtyBefore, v.QtyAfter, v.Catatan, v.PosSkuID = p.before, p.after, kit.Ptr("rincian varian"), kit.Ptr(p.skuID)
		if _, err := ledger.RecordFinishedGoodsMovement(ctx, q, v, now); err != nil {
			return err
		}
	}
	return nil
}
