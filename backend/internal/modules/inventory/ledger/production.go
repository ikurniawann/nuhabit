package ledger

import (
	"context"
	"errors"
	"time"

	"nuhabit/backend/internal/modules/inventory/domain"
	"nuhabit/backend/internal/modules/inventory/kit"
	"nuhabit/backend/internal/platform/database"
)

// OrderConsumption takes a raw material out of stock for the one-shot
// completion of a production order.
type OrderConsumption struct {
	RawMaterialID string
	Qty           float64
	UnitCost      float64 // the order line's cost, kept on the movement
	OrderID       string
	OrderNumber   string
	UserID        string
}

// ConsumeForOrder is consumeMaterials for one line: the material's first
// active balance loses Qty and an `out` movement (reference production)
// records it at the order line's cost. It returns the movement id,
// ErrNoBalance or *ShortageError.
func ConsumeForOrder(ctx context.Context, q database.Querier, in OrderConsumption, now time.Time) (string, error) {
	inv, err := kit.QueryOne(ctx, q, `SELECT id::text, qty_available, unit_cost, branch_id::text, warehouse_id::text
		FROM inventory.inventory WHERE raw_material_id = $1 AND is_active = true LIMIT 1`, in.RawMaterialID)
	if err != nil {
		return "", err
	}
	if inv == nil {
		return "", ErrNoBalance
	}
	before := inv.Num("qty_available")
	if before < in.Qty {
		return "", &ShortageError{Available: before}
	}
	after := before - in.Qty
	id, err := insertMovement(ctx, q, Movement{
		InventoryID: inv.Str("id"), RawMaterialID: in.RawMaterialID, Tipe: "out", Jumlah: in.Qty,
		QtyBefore: before, QtyAfter: after, UnitCost: f(in.UnitCost), TotalCost: f(in.Qty * in.UnitCost),
		BranchID: inv.StrPtr("branch_id"), WarehouseID: inv.StrPtr("warehouse_id"), ReferenceType: "production",
		ReferenceID: s(in.OrderID), ReferenceNumber: s(in.OrderNumber),
		Alasan: s("Pemakaian bahan untuk produksi " + in.OrderNumber), CreatedBy: strOrNil(in.UserID),
	})
	if err != nil {
		return "", err
	}
	_, err = q.Exec(ctx, `UPDATE inventory.inventory SET qty_available = $1, last_movement_at = $2, updated_by = $3 WHERE id = $4`,
		kit.N(after), now, strOrNil(in.UserID), inv.Str("id"))
	return id, err
}

// ErrNoProduct is a WIP material asked for a product that does not exist.
var ErrNoProduct = errors.New("product not found")

// EnsureWipMaterial is ensureWipRawMaterial: the WIP raw material that
// mirrors a product, created on first use with the product's code and unit.
func EnsureWipMaterial(ctx context.Context, q database.Querier, productID, userID string) (string, error) {
	existing, err := kit.QueryOne(ctx, q, `SELECT id::text FROM item.raw_materials WHERE source_product_id = $1 LIMIT 1`, productID)
	if err != nil {
		return "", err
	}
	if existing != nil {
		return existing.Str("id"), nil
	}
	product, err := kit.QueryOne(ctx, q, `SELECT kode, nama, satuan_id::text FROM item.products WHERE id = $1`, productID)
	if err != nil {
		return "", err
	}
	if product == nil {
		return "", ErrNoProduct
	}
	nama := kit.FirstNonEmpty(product.Str("nama"), product.Str("kode"), "WIP")
	var satuan any
	if u := product.Str("satuan_id"); u != "" {
		satuan = u
	}
	row, err := kit.InsertOne(ctx, q, "raw_materials", kit.Obj("kode", domain.WipCode(product.Str("kode")), "nama", nama,
		"kategori", "LAINNYA", "material_type", "WIP", "source_product_id", productID, "satuan_besar_id", satuan,
		"satuan_kecil_id", satuan, "konversi_factor", 1.0, "created_by", userID))
	if err != nil {
		return "", err
	}
	return row.Str("id"), nil
}

// ProductionIssue takes a raw material out of stock for a production order.
type ProductionIssue struct {
	RawMaterialID string
	Qty           float64
	// WarehouseID picks the balance; nil prefers BranchID, then the largest.
	WarehouseID *string
	BranchID    *string
	IssueID     string
	IssueNumber string
	UserID      string
}

// IssuedStock is what an issue took: the movement and the balance's
// average cost at that moment.
type IssuedStock struct {
	MovementID  string
	UnitCost    float64
	WarehouseID *string
}

// ShortageError is a balance without enough stock for an issue.
type ShortageError struct{ Available float64 }

func (e *ShortageError) Error() string { return "insufficient stock" }

// ErrNoBalance is a material without an active balance where it was asked.
var ErrNoBalance = errors.New("no stock balance")

// IssueToProduction locks one balance of the material, refuses a shortage,
// lowers qty_available and writes an `out` movement (reference
// production_issue) at the balance's average cost.
func IssueToProduction(ctx context.Context, q database.Querier, in ProductionIssue, now time.Time) (IssuedStock, error) {
	sql := `SELECT id::text, qty_available, COALESCE(unit_cost, 0), branch_id::text, warehouse_id::text
		FROM inventory.inventory WHERE raw_material_id = $1 AND is_active = true`
	args := []any{in.RawMaterialID}
	if in.WarehouseID != nil && *in.WarehouseID != "" {
		sql += ` AND warehouse_id = $2 LIMIT 1 FOR UPDATE`
		args = append(args, *in.WarehouseID)
	} else {
		sql += ` ORDER BY (branch_id IS NOT DISTINCT FROM $2::uuid) DESC, qty_available DESC, created_at ASC LIMIT 1 FOR UPDATE`
		args = append(args, in.BranchID)
	}
	var b balance
	err := q.QueryRow(ctx, sql, args...).Scan(&b.id, &b.qtyAvailable, &b.unitCost, &b.branchID, &b.warehouseID)
	if database.IsNoRows(err) {
		return IssuedStock{}, ErrNoBalance
	}
	if err != nil {
		return IssuedStock{}, err
	}
	if b.qtyAvailable < in.Qty {
		return IssuedStock{}, &ShortageError{Available: b.qtyAvailable}
	}
	after := b.qtyAvailable - in.Qty
	if _, err := q.Exec(ctx, `UPDATE inventory.inventory SET qty_available = $1, last_movement_at = $2, updated_by = $3,
		updated_at = $2 WHERE id = $4`, kit.N(after), now, strOrNil(in.UserID), b.id); err != nil {
		return IssuedStock{}, err
	}
	id, err := insertMovement(ctx, q, Movement{
		InventoryID: b.id, RawMaterialID: in.RawMaterialID, Tipe: "out", Jumlah: in.Qty,
		QtyBefore: b.qtyAvailable, QtyAfter: after, UnitCost: f(b.unitCost), TotalCost: f(in.Qty * b.unitCost),
		BranchID: b.branchID, WarehouseID: b.warehouseID, ReferenceType: "production_issue",
		ReferenceID: s(in.IssueID), ReferenceNumber: s(in.IssueNumber),
		Alasan: s("Pengeluaran bahan untuk produksi " + in.IssueNumber), CreatedBy: strOrNil(in.UserID),
	})
	if err != nil {
		return IssuedStock{}, err
	}
	return IssuedStock{MovementID: id, UnitCost: b.unitCost, WarehouseID: b.warehouseID}, nil
}

// VariantMovement is one SKU's share of a finished goods receipt.
type VariantMovement struct {
	SkuID         string
	Before, After float64
}

// FinishedGoodsReceipt is produced finished goods coming into stock.
type FinishedGoodsReceipt struct {
	ProductID       string
	Qty             float64
	UnitCost        float64 // HPP of the receipt
	TotalCost       float64
	ReferenceID     string // the production order
	ReferenceNumber string
	Alasan          string
	UserID          string
	Variants        []VariantMovement
}

// AddFinishedGoodsFromProduction adds the output to finished goods at the
// weighted average cost and records the product movement plus one per
// variant (reference production_order).
func AddFinishedGoodsFromProduction(ctx context.Context, q database.Querier, in FinishedGoodsReceipt, now time.Time) error {
	inv, err := kit.QueryOne(ctx, q, `SELECT id::text, qty_available, unit_cost FROM inventory.finished_goods_inventory
		WHERE product_id = $1 LIMIT 1 FOR UPDATE`, in.ProductID)
	if err != nil {
		return err
	}
	var invID string
	before, after, unitCost := 0.0, in.Qty, in.UnitCost
	if inv != nil {
		before = inv.Num("qty_available")
		after = before + in.Qty
		if after > 0 {
			unitCost = (before*inv.Num("unit_cost") + in.TotalCost) / after
		}
		if _, err := q.Exec(ctx, `UPDATE inventory.finished_goods_inventory SET qty_available = $1, unit_cost = $2,
			last_movement_at = $3, updated_by = $4, updated_at = $3 WHERE id = $5`,
			kit.N(after), kit.N(unitCost), now, strOrNil(in.UserID), inv.Get("id")); err != nil {
			return err
		}
		invID = inv.Str("id")
	} else if err := q.QueryRow(ctx, `INSERT INTO inventory.finished_goods_inventory (product_id, qty_available, unit_cost,
		last_movement_at, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING id::text`,
		in.ProductID, kit.N(in.Qty), kit.N(in.UnitCost), now, strOrNil(in.UserID)).Scan(&invID); err != nil {
		return err
	}
	base := FinishedGoodsMovement{
		InventoryID: invID, ProductID: in.ProductID, Tipe: "in", UnitCost: unitCost, ReferenceType: s("production_order"),
		ReferenceID: s(in.ReferenceID), ReferenceNumber: s(in.ReferenceNumber), Alasan: s(in.Alasan), UserID: strOrNil(in.UserID),
	}
	m := base
	m.QtyBefore, m.QtyAfter = before, after
	if _, err := RecordFinishedGoodsMovement(ctx, q, m, now); err != nil {
		return err
	}
	for _, v := range in.Variants {
		vm := base
		vm.QtyBefore, vm.QtyAfter, vm.Catatan, vm.PosSkuID = v.Before, v.After, s("rincian varian"), s(v.SkuID)
		if _, err := RecordFinishedGoodsMovement(ctx, q, vm, now); err != nil {
			return err
		}
	}
	return nil
}
