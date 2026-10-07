package ledger

import (
	"context"
	"errors"
	"math"
	"time"

	"nuhabit/backend/internal/modules/inventory/domain"
	"nuhabit/backend/internal/modules/inventory/kit"
	"nuhabit/backend/internal/platform/database"
)

// Port of addOpeningStockFromImport and setStockFromImport in
// frontend/src/lib/inventory/index.ts: stock written by the raw material
// spreadsheet import.

// ImportStock is one imported stock line. Qty is the quantity added
// (AddOpeningStockFromImport) or the absolute quantity
// (SetStockFromImport), in the material's stock unit.
type ImportStock struct {
	RawMaterialID string
	Qty           float64
	UnitCost      float64
	UserID        string
	// WarehouseID is the stall from the file; nil uses the material's
	// default location.
	WarehouseID  *string
	MaterialKode string
}

// reference is the movement's reference_number: the material code, else
// the first 8 characters of its id.
func (in ImportStock) reference() string {
	if in.MaterialKode != "" {
		return in.MaterialKode
	}
	return in.RawMaterialID[:min(8, len(in.RawMaterialID))]
}

func (in ImportStock) movement(loc Location, alasan string) Movement {
	ref := in.reference()
	return Movement{
		RawMaterialID: in.RawMaterialID, Tipe: "in", BranchID: loc.BranchID, WarehouseID: loc.WarehouseID,
		ReferenceType: "import", ReferenceNumber: s(ref), Alasan: s(alasan + " (" + ref + ")"), CreatedBy: strOrNil(in.UserID),
	}
}

func updateBalance(ctx context.Context, q database.Querier, id string, qty, unitCost float64, loc Location, userID string, now time.Time) error {
	_, err := q.Exec(ctx, `UPDATE inventory.inventory SET qty_available = $1, unit_cost = $2, branch_id = $3,
		warehouse_id = $4, last_movement_at = $5, updated_by = $6 WHERE id = $7`,
		kit.N(qty), kit.N(unitCost), loc.BranchID, loc.WarehouseID, now, strOrNil(userID), id)
	return err
}

// AddOpeningStockFromImport is addOpeningStockFromImport: the opening
// balance of a newly imported material, added to the stall's balance at a
// weighted-average cost, with an `in` movement.
func AddOpeningStockFromImport(ctx context.Context, q database.Querier, in ImportStock, now time.Time) error {
	qty := kit.ToNum(in.Qty)
	if qty <= 0 {
		return nil
	}
	loc, err := locationFor(ctx, q, in.RawMaterialID, in.WarehouseID)
	if err != nil {
		return err
	}
	cost := kit.ToNum(in.UnitCost)
	b, err := findBalance(ctx, q, in.RawMaterialID, loc.WarehouseID, "eqOrNull")
	if err != nil {
		return err
	}
	mv := in.movement(loc, "Opening stock from raw material import")
	mv.Jumlah = qty
	if b != nil {
		total := b.qtyAvailable + qty
		unitCost := domain.WeightedAverage(b.qtyAvailable, b.unitCost, qty, cost)
		if err := updateBalance(ctx, q, b.id, total, unitCost, loc, in.UserID, now); err != nil {
			return err
		}
		mv.InventoryID, mv.QtyBefore, mv.QtyAfter, mv.UnitCost, mv.TotalCost = b.id, b.qtyAvailable, total, f(unitCost), f(qty*unitCost)
	} else {
		id, err := insertBalance(ctx, q, in.RawMaterialID, qty, 0, cost, loc, strOrNil(in.UserID), now, true)
		if err != nil {
			return err
		}
		mv.InventoryID, mv.QtyAfter, mv.UnitCost, mv.TotalCost = id, qty, f(cost), f(qty*cost)
	}
	return InsertMovement(ctx, q, mv)
}

// SetStockFromImport is setStockFromImport: re-importing an exported sheet
// sets the stall's balance to the file's quantity; a change is an
// `adjustment` movement, a new balance an `in` movement.
func SetStockFromImport(ctx context.Context, q database.Querier, in ImportStock, now time.Time) error {
	qtyActual := kit.ToNum(in.Qty)
	if qtyActual < 0 {
		return errors.New("Stock quantity cannot be negative")
	}
	loc, err := locationFor(ctx, q, in.RawMaterialID, in.WarehouseID)
	if err != nil {
		return err
	}
	cost := kit.ToNum(in.UnitCost)
	b, err := findBalance(ctx, q, in.RawMaterialID, loc.WarehouseID, "eqOrNull")
	if err != nil {
		return err
	}
	if b != nil {
		unitCost := b.unitCost
		if qtyActual > 0 && cost != 0 {
			unitCost = cost
		}
		if err := updateBalance(ctx, q, b.id, qtyActual, unitCost, loc, in.UserID, now); err != nil {
			return err
		}
		diff := math.Abs(qtyActual - b.qtyAvailable)
		if diff == 0 {
			return nil
		}
		mv := in.movement(loc, "Stock updated from import")
		mv.Tipe, mv.InventoryID, mv.Jumlah, mv.QtyBefore, mv.QtyAfter = "adjustment", b.id, diff, b.qtyAvailable, qtyActual
		mv.UnitCost, mv.TotalCost = f(unitCost), f(diff*unitCost)
		return InsertMovement(ctx, q, mv)
	}
	if qtyActual == 0 {
		return nil
	}
	id, err := insertBalance(ctx, q, in.RawMaterialID, qtyActual, 0, cost, loc, strOrNil(in.UserID), now, true)
	if err != nil {
		return err
	}
	mv := in.movement(loc, "Opening stock from import")
	mv.InventoryID, mv.Jumlah, mv.QtyAfter, mv.UnitCost, mv.TotalCost = id, qtyActual, qtyActual, f(cost), f(qtyActual*cost)
	return InsertMovement(ctx, q, mv)
}
