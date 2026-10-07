// Package ledger moves raw material, finished goods and supply stock: the
// balance rows (inventory.inventory, finished_goods_inventory,
// supply_inventory) and their movement ledgers. Every function runs on the
// caller's Querier, so it joins the caller's transaction. Batches follow from
// the trg_inventory_movement_batches trigger on inventory_movements.
//
// Ported from frontend/src/lib/inventory/index.ts, finished-goods-movements.ts,
// product-stock-opname.ts (ensureProductInventoryId), product-purchase-return.ts,
// stock-opname.ts (ensureWarehouseInventoryId), and
// frontend/src/lib/purchasing/supply-inventory.ts and purchase-price.ts.
package ledger

import (
	"context"
	"errors"
	"fmt"
	"math"
	"time"

	"nuhabit/backend/internal/modules/inventory/domain"
	"nuhabit/backend/internal/modules/inventory/kit"
	"nuhabit/backend/internal/platform/database"
)

// Location is where a material's stock lives.
type Location struct {
	BranchID    *string
	WarehouseID *string
}

// ResolveLocation is resolveInventoryLocation: the material's branch and
// that branch's default (else oldest) active warehouse; a global material
// has neither.
func ResolveLocation(ctx context.Context, q database.Querier, rawMaterialID string) (Location, error) {
	var loc Location
	m, err := kit.QueryOne(ctx, q, `SELECT branch_id::text FROM raw_materials WHERE id = $1`, rawMaterialID)
	if err != nil || m == nil || m.StrPtr("branch_id") == nil {
		return loc, err
	}
	loc.BranchID = m.StrPtr("branch_id")
	w, err := kit.QueryOne(ctx, q, `SELECT id::text FROM configuration.warehouses
		WHERE branch_id = $1 AND is_active = true ORDER BY is_default DESC, created_at ASC LIMIT 1`, *loc.BranchID)
	if err != nil {
		return loc, err
	}
	if w != nil {
		loc.WarehouseID = w.StrPtr("id")
	}
	return loc, nil
}

// warehouseLocation is the location of an explicit warehouse (its branch
// may be unknown).
func warehouseLocation(ctx context.Context, q database.Querier, warehouseID string) (Location, error) {
	loc := Location{WarehouseID: &warehouseID}
	w, err := kit.QueryOne(ctx, q, `SELECT branch_id::text FROM configuration.warehouses WHERE id = $1`, warehouseID)
	if err == nil && w != nil {
		loc.BranchID = w.StrPtr("branch_id")
	}
	return loc, err
}

func locationFor(ctx context.Context, q database.Querier, rawMaterialID string, warehouseID *string) (Location, error) {
	if warehouseID != nil && *warehouseID != "" {
		return warehouseLocation(ctx, q, *warehouseID)
	}
	return ResolveLocation(ctx, q, rawMaterialID)
}

// Movement is one inventory.inventory_movements row.
type Movement struct {
	InventoryID     string
	RawMaterialID   string
	Tipe            string
	Jumlah          float64
	QtyBefore       float64
	QtyAfter        float64
	UnitCost        *float64 // nil = NULL
	TotalCost       *float64
	BranchID        *string
	WarehouseID     *string
	ReferenceType   string
	ReferenceID     *string
	ReferenceNumber *string
	ReturnID        *string
	Alasan          *string
	Catatan         *string
	BatchNumber     *string
	ExpiryDate      *string
	BatchID         *string
	CreatedBy       *string
	UpdatedBy       *string
}

func num(f *float64) any {
	if f == nil {
		return nil
	}
	return kit.N(*f)
}

// InsertMovement writes one movement row.
func InsertMovement(ctx context.Context, q database.Querier, m Movement) error {
	_, err := q.Exec(ctx, `INSERT INTO inventory.inventory_movements (
		inventory_id, raw_material_id, tipe, jumlah, qty_before, qty_after, unit_cost, total_cost,
		branch_id, warehouse_id, reference_type, reference_id, reference_number, return_id,
		alasan, catatan, batch_number, expiry_date, batch_id, created_by, updated_by)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)`,
		m.InventoryID, m.RawMaterialID, m.Tipe, kit.N(m.Jumlah), kit.N(m.QtyBefore), kit.N(m.QtyAfter), num(m.UnitCost), num(m.TotalCost),
		m.BranchID, m.WarehouseID, m.ReferenceType, m.ReferenceID, m.ReferenceNumber, m.ReturnID,
		m.Alasan, m.Catatan, m.BatchNumber, m.ExpiryDate, m.BatchID, m.CreatedBy, m.UpdatedBy)
	return err
}

func f(v float64) *float64 { return &v }
func s(v string) *string   { return &v }

func strOrNil(v string) *string {
	if v == "" {
		return nil
	}
	return &v
}

type balance struct {
	id                       string
	qtyAvailable, qtyOnOrder float64
	unitCost                 float64
	branchID, warehouseID    *string
}

// findBalance loads the active balance of a material, filtered by
// warehouse_id = $2 when byWarehouse (NULL never matches, as `.eq(col,
// null)` in the shim), IS NULL when nullWarehouse, else any warehouse.
func findBalance(ctx context.Context, q database.Querier, rawMaterialID string, warehouse *string, mode string) (*balance, error) {
	sql := `SELECT id::text, qty_available, qty_on_order, unit_cost, branch_id::text, warehouse_id::text
		FROM inventory.inventory WHERE raw_material_id = $1 AND is_active = true`
	args := []any{rawMaterialID}
	switch mode {
	case "eq":
		sql += ` AND warehouse_id = $2`
		args = append(args, warehouse)
	case "eqOrNull":
		if warehouse != nil {
			sql += ` AND warehouse_id = $2`
			args = append(args, *warehouse)
		} else {
			sql += ` AND warehouse_id IS NULL`
		}
	}
	row, err := kit.QueryOne(ctx, q, sql+` LIMIT 1`, args...)
	if err != nil || row == nil {
		return nil, err
	}
	return &balance{
		id: row.Str("id"), qtyAvailable: row.Num("qty_available"), qtyOnOrder: row.Num("qty_on_order"),
		unitCost: row.Num("unit_cost"), branchID: row.StrPtr("branch_id"), warehouseID: row.StrPtr("warehouse_id"),
	}, nil
}

func insertBalance(ctx context.Context, q database.Querier, rawMaterialID string, qty, onOrder, unitCost float64, loc Location, userID *string, now time.Time, touched bool) (string, error) {
	var last any
	if touched {
		last = now
	}
	var id string
	err := q.QueryRow(ctx, `INSERT INTO inventory.inventory
		(raw_material_id, qty_available, qty_on_order, unit_cost, branch_id, warehouse_id, last_movement_at, created_by)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id::text`,
		rawMaterialID, kit.N(qty), kit.N(onOrder), kit.N(unitCost), loc.BranchID, loc.WarehouseID, last, userID).Scan(&id)
	return id, err
}

/* ── purchasing ──────────────────────────────────────────────────────── */

// AdjustOnOrder is adjustInventoryOnOrder: qty_on_order moves by delta (PO
// sent +, cancelled −), never below zero; a material without a balance gets
// one only for a positive delta.
func AdjustOnOrder(ctx context.Context, q database.Querier, rawMaterialID string, delta float64, userID *string, now time.Time) error {
	if delta == 0 {
		return nil
	}
	b, err := findBalance(ctx, q, rawMaterialID, nil, "any")
	if err != nil {
		return err
	}
	if b != nil {
		_, err = q.Exec(ctx, `UPDATE inventory.inventory SET qty_on_order = $1, updated_by = $2 WHERE id = $3`,
			kit.N(math.Max(0, b.qtyOnOrder+delta)), userID, b.id)
		return err
	}
	if delta < 0 {
		return nil
	}
	loc, err := ResolveLocation(ctx, q, rawMaterialID)
	if err != nil {
		return err
	}
	_, err = q.Exec(ctx, `INSERT INTO inventory.inventory
		(raw_material_id, qty_available, qty_on_order, unit_cost, branch_id, warehouse_id, created_by)
		VALUES ($1, 0, $2, 0, $3, $4, $5)`, rawMaterialID, kit.N(delta), loc.BranchID, loc.WarehouseID, userID)
	return err
}

// GrnReceipt is one accepted GRN line in base units.
type GrnReceipt struct {
	RawMaterialID string
	Qty           float64 // base units
	UnitCost      float64 // per base unit
	GrnID         string
	GrnNumber     string
	UserID        string
	WarehouseID   *string
	BatchNumber   *string
	ExpiryDate    *string // YYYY-MM-DD
}

// AddFromGrn is addInventoryFromGrn: stock in at the receipt warehouse (or
// the material's default location), weighted-average cost, qty_on_order
// released, an `in` movement at the transaction cost carrying the batch,
// then the master purchase price follows the receipt.
func AddFromGrn(ctx context.Context, q database.Querier, in GrnReceipt, now time.Time) error {
	qty, cost := kit.ToNum(in.Qty), kit.ToNum(in.UnitCost)
	if qty <= 0 {
		return nil
	}
	loc, err := locationFor(ctx, q, in.RawMaterialID, in.WarehouseID)
	if err != nil {
		return err
	}
	b, err := findBalance(ctx, q, in.RawMaterialID, loc.WarehouseID, "eq")
	if err != nil {
		return err
	}
	var batchNumber, expiry *string
	if in.BatchNumber != nil && *in.BatchNumber != "" {
		batchNumber = in.BatchNumber
	}
	if in.ExpiryDate != nil && len(*in.ExpiryDate) >= 10 {
		expiry = s((*in.ExpiryDate)[:10])
	}
	mv := Movement{
		RawMaterialID: in.RawMaterialID, Tipe: "in", Jumlah: qty, UnitCost: f(cost), TotalCost: f(qty * cost),
		BranchID: loc.BranchID, WarehouseID: loc.WarehouseID, ReferenceType: "grn", ReferenceID: s(in.GrnID),
		ReferenceNumber: s(in.GrnNumber), Alasan: s("Penerimaan barang dari GRN " + in.GrnNumber),
		CreatedBy: strOrNil(in.UserID), BatchNumber: batchNumber, ExpiryDate: expiry,
	}
	if b != nil {
		total := b.qtyAvailable + qty
		_, err = q.Exec(ctx, `UPDATE inventory.inventory SET qty_available = $1, qty_on_order = $2, unit_cost = $3,
			branch_id = $4, warehouse_id = $5, last_movement_at = $6, updated_by = $7 WHERE id = $8`,
			kit.N(total), kit.N(math.Max(0, b.qtyOnOrder-qty)), kit.N(domain.WeightedAverage(b.qtyAvailable, b.unitCost, qty, cost)),
			loc.BranchID, loc.WarehouseID, now, strOrNil(in.UserID), b.id)
		if err != nil {
			return err
		}
		mv.InventoryID, mv.QtyBefore, mv.QtyAfter = b.id, b.qtyAvailable, total
	} else {
		id, err := insertBalance(ctx, q, in.RawMaterialID, qty, 0, cost, loc, strOrNil(in.UserID), now, true)
		if err != nil {
			return err
		}
		mv.InventoryID, mv.QtyBefore, mv.QtyAfter = id, 0, qty
	}
	if err := InsertMovement(ctx, q, mv); err != nil {
		return err
	}
	return UpdateLastPurchasePrice(ctx, q, in.RawMaterialID, cost, strOrNil(in.UserID), now)
}

// UpdateLastPurchasePrice is updateRawMaterialLastPurchasePrice: the master
// harga_beli (per satuan besar) follows the latest receipt cost.
func UpdateLastPurchasePrice(ctx context.Context, q database.Querier, rawMaterialID string, baseUnitCost float64, userID *string, now time.Time) error {
	if baseUnitCost <= 0 {
		return nil
	}
	m, err := kit.QueryOne(ctx, q, `SELECT satuan_besar_id::text, satuan_kecil_id::text, konversi_factor
		FROM raw_materials WHERE id = $1 AND deleted_at IS NULL`, rawMaterialID)
	if err != nil || m == nil {
		return err
	}
	harga := domain.MasterHargaBeliFromBaseUnitCost(baseUnitCost, &domain.Material{
		SatuanBesarID: m.StrPtr("satuan_besar_id"), SatuanKecilID: m.StrPtr("satuan_kecil_id"), KonversiFactor: m.NumPtr("konversi_factor"),
	})
	if harga <= 0 {
		return nil
	}
	_, err = q.Exec(ctx, `UPDATE raw_materials SET harga_beli = $1, updated_by = $2, updated_at = $3 WHERE id = $4`,
		kit.N(harga), userID, now, rawMaterialID)
	return err
}

// ErrInsufficientReturnStock is the TS `new Error(...)` a purchase return
// raises when the receipt warehouse no longer holds the quantity. The TS
// route answers it with a 500.
var ErrInsufficientReturnStock = errors.New("Insufficient stock in the receipt warehouse for this return")

// ErrInsufficientProductReturnStock is the finished goods variant.
var ErrInsufficientProductReturnStock = errors.New("Insufficient product stock for this return")

const qtyEpsilon = 0.000001

// PurchaseReturn is one approved purchase return line.
type PurchaseReturn struct {
	RawMaterialID  string
	ProductID      string
	Qty            float64
	UnitCost       float64
	ReturnID       string
	ReturnNumber   string
	WarehouseID    *string
	UserID         string
	ConditionNotes *string
}

// ReduceForPurchaseReturn is reduceInventoryFromPurchaseReturn.
func ReduceForPurchaseReturn(ctx context.Context, q database.Querier, in PurchaseReturn, now time.Time) error {
	qty := kit.ToNum(in.Qty)
	if qty <= 0 {
		return nil
	}
	loc, err := locationFor(ctx, q, in.RawMaterialID, in.WarehouseID)
	if err != nil {
		return err
	}
	b, err := findBalance(ctx, q, in.RawMaterialID, loc.WarehouseID, "eqOrNull")
	if err != nil {
		return err
	}
	if b == nil || b.qtyAvailable+qtyEpsilon < qty {
		return ErrInsufficientReturnStock
	}
	after := math.Max(0, b.qtyAvailable-qty)
	unitCost := kit.ToNum(in.UnitCost)
	if unitCost == 0 {
		unitCost = b.unitCost
	}
	if _, err := q.Exec(ctx, `UPDATE inventory.inventory SET qty_available = $1, branch_id = $2, warehouse_id = $3,
		last_movement_at = $4, updated_by = $5 WHERE id = $6`,
		kit.N(after), loc.BranchID, loc.WarehouseID, now, strOrNil(in.UserID), b.id); err != nil {
		return err
	}
	alasan := "Purchase return " + in.ReturnNumber
	if in.ConditionNotes != nil && *in.ConditionNotes != "" {
		alasan += ": " + *in.ConditionNotes
	}
	return InsertMovement(ctx, q, Movement{
		InventoryID: b.id, RawMaterialID: in.RawMaterialID, Tipe: "return", Jumlah: qty,
		QtyBefore: b.qtyAvailable, QtyAfter: after, UnitCost: f(unitCost), TotalCost: f(qty * unitCost),
		BranchID: loc.BranchID, WarehouseID: loc.WarehouseID, ReferenceType: "purchase_return",
		ReferenceID: s(in.ReturnID), ReferenceNumber: s(in.ReturnNumber), ReturnID: s(in.ReturnID),
		Alasan: &alasan, CreatedBy: strOrNil(in.UserID),
	})
}

// ReduceProductForPurchaseReturn is reduceProductInventoryFromPurchaseReturn.
func ReduceProductForPurchaseReturn(ctx context.Context, q database.Querier, in PurchaseReturn, now time.Time) error {
	qty := kit.ToNum(in.Qty)
	if qty <= 0 {
		return nil
	}
	invID, err := EnsureProductInventoryID(ctx, q, in.ProductID, kit.ToNum(in.UnitCost), strOrNil(in.UserID))
	if err != nil {
		return err
	}
	cur, err := kit.QueryOne(ctx, q, `SELECT id::text, qty_available, unit_cost FROM inventory.finished_goods_inventory
		WHERE id = $1 AND is_active = true`, invID)
	if err != nil {
		return err
	}
	if cur == nil || cur.Num("qty_available")+qtyEpsilon < qty {
		return ErrInsufficientProductReturnStock
	}
	before := cur.Num("qty_available")
	after := math.Max(0, before-qty)
	if _, err := q.Exec(ctx, `UPDATE inventory.finished_goods_inventory SET qty_available = $1, last_movement_at = $2,
		updated_by = $3 WHERE id = $4`, kit.N(after), now, strOrNil(in.UserID), invID); err != nil {
		return err
	}
	unitCost := cur.Num("unit_cost")
	if unitCost == 0 {
		unitCost = kit.ToNum(in.UnitCost)
	}
	_, err = RecordFinishedGoodsMovement(ctx, q, FinishedGoodsMovement{
		InventoryID: invID, ProductID: in.ProductID, Tipe: "return", QtyBefore: before, QtyAfter: after,
		UnitCost: unitCost, ReferenceType: s("product_purchase_return"), ReferenceID: s(in.ReturnID),
		ReferenceNumber: s(in.ReturnNumber), Alasan: s("Purchase return approved"), Catatan: in.ConditionNotes,
		UserID: strOrNil(in.UserID),
	}, now)
	return err
}

/* ── production ──────────────────────────────────────────────────────── */

// ProductionOutput is a WIP / intermediate material produced in-house.
type ProductionOutput struct {
	RawMaterialID    string
	Qty              float64
	UnitCost         float64
	OrderID          string
	ProductionNumber string
	UserID           string
	// ReferenceType is the idempotency key's type ("production_wip").
	ReferenceType string
}

// AddFromProduction is addInventoryFromProduction: idempotent per
// (material, reference type, order); the movement is always written as
// production_wip at the new average cost.
func AddFromProduction(ctx context.Context, q database.Querier, in ProductionOutput, now time.Time) error {
	if in.Qty <= 0 {
		return nil
	}
	refType := in.ReferenceType
	if refType == "" {
		refType = "production_wip"
	}
	dup, err := kit.QueryOne(ctx, q, `SELECT id FROM inventory.inventory_movements
		WHERE raw_material_id = $1 AND reference_type = $2 AND reference_id = $3 AND is_active = true LIMIT 1`,
		in.RawMaterialID, refType, in.OrderID)
	if err != nil || dup != nil {
		return err
	}
	loc, err := ResolveLocation(ctx, q, in.RawMaterialID)
	if err != nil {
		return err
	}
	b, err := findBalance(ctx, q, in.RawMaterialID, nil, "any")
	if err != nil {
		return err
	}
	var invID string
	before, newCost := 0.0, in.UnitCost
	if b != nil {
		before = b.qtyAvailable
		newCost = domain.WeightedAverage(before, b.unitCost, in.Qty, in.UnitCost)
		if _, err := q.Exec(ctx, `UPDATE inventory.inventory SET qty_available = $1, unit_cost = $2, branch_id = $3,
			warehouse_id = $4, last_movement_at = $5, updated_by = $6 WHERE id = $7`,
			kit.N(before+in.Qty), kit.N(newCost), loc.BranchID, loc.WarehouseID, now, strOrNil(in.UserID), b.id); err != nil {
			return err
		}
		invID = b.id
	} else if invID, err = insertBalance(ctx, q, in.RawMaterialID, in.Qty, 0, in.UnitCost, loc, strOrNil(in.UserID), now, true); err != nil {
		return err
	}
	return InsertMovement(ctx, q, Movement{
		InventoryID: invID, RawMaterialID: in.RawMaterialID, Tipe: "in", Jumlah: in.Qty,
		QtyBefore: before, QtyAfter: before + in.Qty, UnitCost: f(newCost), TotalCost: f(in.Qty * newCost),
		BranchID: loc.BranchID, WarehouseID: loc.WarehouseID, ReferenceType: "production_wip",
		ReferenceID: s(in.OrderID), ReferenceNumber: s(in.ProductionNumber),
		Alasan: s("Output WIP dari produksi " + in.ProductionNumber), CreatedBy: strOrNil(in.UserID),
	})
}

/* ── warehouse rows ──────────────────────────────────────────────────── */

// EnsureWarehouseInventoryID is ensureWarehouseInventoryId: the material's
// active balance at a warehouse, created empty when missing.
func EnsureWarehouseInventoryID(ctx context.Context, q database.Querier, rawMaterialID, warehouseID string, branchID *string, unitCost float64, userID string) (string, error) {
	row, err := kit.QueryOne(ctx, q, `SELECT id::text FROM inventory
		WHERE raw_material_id = $1 AND warehouse_id = $2 AND is_active = true LIMIT 1`, rawMaterialID, warehouseID)
	if err != nil {
		return "", err
	}
	if row != nil {
		return row.Str("id"), nil
	}
	var id string
	err = q.QueryRow(ctx, `INSERT INTO inventory (raw_material_id, warehouse_id, branch_id, qty_available, unit_cost,
		is_active, created_by, updated_by) VALUES ($1, $2, $3, 0, $4, true, $5, $5) RETURNING id::text`,
		rawMaterialID, warehouseID, branchID, kit.N(unitCost), strOrNil(userID)).Scan(&id)
	return id, err
}

/* ── finished goods ──────────────────────────────────────────────────── */

// EnsureProductInventoryID is ensureProductInventoryId.
func EnsureProductInventoryID(ctx context.Context, q database.Querier, productID string, unitCost float64, userID *string) (string, error) {
	row, err := kit.QueryOne(ctx, q, `SELECT id::text FROM inventory.finished_goods_inventory
		WHERE product_id = $1 AND is_active = true LIMIT 1`, productID)
	if err != nil {
		return "", err
	}
	if row != nil {
		return row.Str("id"), nil
	}
	var id string
	err = q.QueryRow(ctx, `INSERT INTO finished_goods_inventory (product_id, qty_available, unit_cost, is_active,
		created_by, updated_by) VALUES ($1, 0, $2, true, $3, $3) RETURNING id::text`, productID, kit.N(unitCost), userID).Scan(&id)
	return id, err
}

// FinishedGoodsMovement is one inventory.finished_goods_movements row.
type FinishedGoodsMovement struct {
	InventoryID     string
	ProductID       string
	Tipe            string
	QtyBefore       float64
	QtyAfter        float64
	UnitCost        float64
	ReferenceType   *string
	ReferenceID     *string
	ReferenceNumber *string
	Alasan          *string
	Catatan         *string
	UserID          *string
	WarehouseID     *string
	BranchID        *string
	PosSkuID        *string
}

// RecordFinishedGoodsMovement is recordFinishedGoodsMovement /
// insertFinishedGoodsMovementSql: nothing when the quantity did not change;
// warehouse and branch fall back to the product's. It returns the new id.
func RecordFinishedGoodsMovement(ctx context.Context, q database.Querier, m FinishedGoodsMovement, now time.Time) (string, error) {
	jumlah := math.Abs(m.QtyAfter - m.QtyBefore)
	if jumlah == 0 {
		return "", nil
	}
	if m.WarehouseID == nil || m.BranchID == nil {
		p, err := kit.QueryOne(ctx, q, `SELECT warehouse_id::text, branch_id::text FROM item.products
			WHERE id = $1 AND deleted_at IS NULL`, m.ProductID)
		if err != nil {
			return "", err
		}
		if p != nil {
			if m.WarehouseID == nil {
				m.WarehouseID = p.StrPtr("warehouse_id")
			}
			if m.BranchID == nil {
				m.BranchID = p.StrPtr("branch_id")
			}
		}
	}
	var id string
	err := q.QueryRow(ctx, `INSERT INTO inventory.finished_goods_movements
		(inventory_id, product_id, warehouse_id, branch_id, tipe, jumlah, qty_before, qty_after, unit_cost, total_cost,
		 reference_type, reference_id, reference_number, alasan, catatan, pos_sku_id, is_active, created_by, updated_by,
		 created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, true, $17, $17, $18, $18)
		RETURNING id::text`,
		m.InventoryID, m.ProductID, m.WarehouseID, m.BranchID, m.Tipe, kit.N(jumlah), kit.N(m.QtyBefore), kit.N(m.QtyAfter),
		kit.N(m.UnitCost), kit.N(jumlah*m.UnitCost), m.ReferenceType, m.ReferenceID, m.ReferenceNumber, m.Alasan, m.Catatan,
		m.PosSkuID, m.UserID, now).Scan(&id)
	return id, err
}

/* ── supply items (inventory.supply_inventory) ───────────────────────── */

const zeroUUID = "00000000-0000-0000-0000-000000000000"

type supplyBalance struct {
	id                                 string
	qtyAvailable, qtyOnOrder, unitCost float64
}

func warehouseBranch(ctx context.Context, q database.Querier, warehouseID *string) (*string, error) {
	if warehouseID == nil || *warehouseID == "" {
		return nil, nil
	}
	w, err := kit.QueryOne(ctx, q, `SELECT branch_id::text FROM configuration.warehouses WHERE id = $1`, *warehouseID)
	if err != nil || w == nil {
		return nil, err
	}
	return w.StrPtr("branch_id"), nil
}

// SupplyTarget identifies a supply balance and who touches it.
type SupplyTarget struct {
	SupplyItemID string
	WarehouseID  *string
	CompanyID    *string
	BranchID     *string // nil = the warehouse's branch
	UserID       *string
}

func (t *SupplyTarget) resolveBranch(ctx context.Context, q database.Querier) error {
	if t.BranchID != nil {
		return nil
	}
	b, err := warehouseBranch(ctx, q, t.WarehouseID)
	t.BranchID = b
	return err
}

// getOrCreateSupply is getOrCreateSupplyInventory (warehouse matched with
// COALESCE to the zero uuid, like the unique index).
func getOrCreateSupply(ctx context.Context, q database.Querier, t SupplyTarget) (supplyBalance, error) {
	want := zeroUUID
	if t.WarehouseID != nil {
		want = *t.WarehouseID
	}
	rows, err := kit.Query(ctx, q, `SELECT id::text, qty_available, qty_on_order, unit_cost, warehouse_id::text
		FROM supply_inventory WHERE supply_item_id = $1 AND is_active = true`, t.SupplyItemID)
	if err != nil {
		return supplyBalance{}, err
	}
	for _, r := range rows {
		got := zeroUUID
		if w := r.StrPtr("warehouse_id"); w != nil {
			got = *w
		}
		if got == want {
			return supplyBalance{r.Str("id"), r.Num("qty_available"), r.Num("qty_on_order"), r.Num("unit_cost")}, nil
		}
	}
	var b supplyBalance
	err = q.QueryRow(ctx, `INSERT INTO supply_inventory (supply_item_id, warehouse_id, qty_available, qty_on_order,
		unit_cost, company_id, branch_id, created_by) VALUES ($1, $2, 0, 0, 0, $3, $4, $5)
		RETURNING id::text`, t.SupplyItemID, t.WarehouseID, t.CompanyID, t.BranchID, t.UserID).Scan(&b.id)
	if err != nil {
		return b, fmt.Errorf("Gagal membuat baris stok barang operasional: %w", err)
	}
	return b, nil
}

// SupplyMovement is one supply_inventory_movements row.
type SupplyMovement struct {
	Tipe            string
	Jumlah          float64
	QtyBefore       float64
	QtyAfter        float64
	UnitCost        *float64
	TotalCost       *float64
	ReferenceType   string
	ReferenceID     *string
	ReferenceNumber *string
	Alasan          *string
	Catatan         *string
}

func recordSupplyMovement(ctx context.Context, q database.Querier, t SupplyTarget, invID string, m SupplyMovement) error {
	_, err := q.Exec(ctx, `INSERT INTO supply_inventory_movements (supply_inventory_id, supply_item_id, warehouse_id,
		tipe, jumlah, qty_before, qty_after, unit_cost, total_cost, reference_type, reference_id, reference_number,
		alasan, catatan, company_id, branch_id, created_by)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
		invID, t.SupplyItemID, t.WarehouseID, m.Tipe, kit.N(m.Jumlah), kit.N(m.QtyBefore), kit.N(m.QtyAfter), num(m.UnitCost),
		num(m.TotalCost), m.ReferenceType, m.ReferenceID, m.ReferenceNumber, m.Alasan, m.Catatan, t.CompanyID, t.BranchID, t.UserID)
	return err
}

// AddSupplyFromGrn is addSupplyStockFromGrn.
func AddSupplyFromGrn(ctx context.Context, q database.Querier, t SupplyTarget, qty, unitCost float64, grnID, grnNumber string, now time.Time) error {
	if qty <= 0 {
		return nil
	}
	if err := t.resolveBranch(ctx, q); err != nil {
		return err
	}
	b, err := getOrCreateSupply(ctx, q, t)
	if err != nil {
		return err
	}
	after := b.qtyAvailable + qty
	cost := 0.0
	if after != 0 {
		cost = (b.qtyAvailable*b.unitCost + qty*unitCost) / after
	}
	if _, err := q.Exec(ctx, `UPDATE supply_inventory SET qty_available = $1, qty_on_order = $2, unit_cost = $3,
		last_movement_at = $4, updated_by = $5, updated_at = $4 WHERE id = $6`,
		kit.N(after), kit.N(math.Max(0, b.qtyOnOrder-qty)), kit.N(cost), now, t.UserID, b.id); err != nil {
		return err
	}
	return recordSupplyMovement(ctx, q, t, b.id, SupplyMovement{
		Tipe: "in", Jumlah: qty, QtyBefore: b.qtyAvailable, QtyAfter: after, UnitCost: f(cost), TotalCost: f(qty * cost),
		ReferenceType: "grn", ReferenceID: s(grnID), ReferenceNumber: s(grnNumber),
		Alasan: s("Penerimaan barang dari GRN " + grnNumber),
	})
}

// SupplyIssue is reduceSupplyStock's input.
type SupplyIssue struct {
	Qty             float64
	ReferenceType   string
	ReferenceID     *string
	ReferenceNumber *string
	Alasan          *string
	Catatan         *string
}

// ErrSupplyShort is reduceSupplyStock's 400.
type ErrSupplyShort struct{ Available, Requested float64 }

func (e ErrSupplyShort) Error() string {
	return "Stok tidak cukup (tersedia " + kit.JSNum(e.Available) + ", diminta " + kit.JSNum(e.Requested) + ")"
}

// ReduceSupply is reduceSupplyStock; it returns the unit cost issued at.
func ReduceSupply(ctx context.Context, q database.Querier, t SupplyTarget, in SupplyIssue, now time.Time) (float64, error) {
	if in.Qty <= 0 {
		return 0, nil
	}
	if err := t.resolveBranch(ctx, q); err != nil {
		return 0, err
	}
	b, err := getOrCreateSupply(ctx, q, t)
	if err != nil {
		return 0, err
	}
	if in.Qty > b.qtyAvailable {
		return 0, ErrSupplyShort{Available: b.qtyAvailable, Requested: in.Qty}
	}
	after := b.qtyAvailable - in.Qty
	if _, err := q.Exec(ctx, `UPDATE supply_inventory SET qty_available = $1, last_movement_at = $2, updated_by = $3,
		updated_at = $2 WHERE id = $4`, kit.N(after), now, t.UserID, b.id); err != nil {
		return 0, err
	}
	return b.unitCost, recordSupplyMovement(ctx, q, t, b.id, SupplyMovement{
		Tipe: "out", Jumlah: in.Qty, QtyBefore: b.qtyAvailable, QtyAfter: after, UnitCost: f(b.unitCost),
		TotalCost: f(in.Qty * b.unitCost), ReferenceType: in.ReferenceType, ReferenceID: in.ReferenceID,
		ReferenceNumber: in.ReferenceNumber, Alasan: in.Alasan, Catatan: in.Catatan,
	})
}

// SupplyAdjustment is adjustSupplyStock's result.
type SupplyAdjustment struct {
	QtyBefore float64 `json:"qtyBefore"`
	QtyAfter  float64 `json:"qtyAfter"`
	QtyDiff   float64 `json:"qtyDiff"`
}

// AdjustSupply is adjustSupplyStock: set the balance to qtyActual and log
// the difference as an `adjustment` movement.
func AdjustSupply(ctx context.Context, q database.Querier, t SupplyTarget, qtyActual float64, alasan, catatan *string, now time.Time) (SupplyAdjustment, error) {
	if err := t.resolveBranch(ctx, q); err != nil {
		return SupplyAdjustment{}, err
	}
	b, err := getOrCreateSupply(ctx, q, t)
	if err != nil {
		return SupplyAdjustment{}, err
	}
	diff := qtyActual - b.qtyAvailable
	if _, err := q.Exec(ctx, `UPDATE supply_inventory SET qty_available = $1, last_movement_at = $2, updated_by = $3,
		updated_at = $2 WHERE id = $4`, kit.N(qtyActual), now, t.UserID, b.id); err != nil {
		return SupplyAdjustment{}, err
	}
	if diff != 0 {
		if alasan == nil {
			alasan = s("Penyesuaian stok: " + domain.SignedDiff(diff))
		}
		if err := recordSupplyMovement(ctx, q, t, b.id, SupplyMovement{
			Tipe: "adjustment", Jumlah: math.Abs(diff), QtyBefore: b.qtyAvailable, QtyAfter: qtyActual,
			UnitCost: f(b.unitCost), TotalCost: f(math.Abs(diff) * b.unitCost), ReferenceType: "adjustment",
			Alasan: alasan, Catatan: catatan,
		}); err != nil {
			return SupplyAdjustment{}, err
		}
	}
	return SupplyAdjustment{QtyBefore: b.qtyAvailable, QtyAfter: qtyActual, QtyDiff: diff}, nil
}
