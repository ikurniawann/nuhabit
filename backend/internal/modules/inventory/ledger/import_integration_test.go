package ledger_test

import (
	"testing"
	"time"

	"nuhabit/backend/internal/modules/inventory/kit/kittest"
	"nuhabit/backend/internal/modules/inventory/ledger"
)

// The raw material spreadsheet import's stock writes
// (catalog/import_raw_materials.go).
func TestImportStock(t *testing.T) {
	e := kittest.Setup(t, kittest.Menus, nil)
	org := e.NewOrg()
	now := time.Now()
	rm := e.RawMaterial(org, "RMI-"+org.BranchID[:4], "Tepung", e.Unit("KG", "Kilogram"), "", 1)
	e.Stock(org, rm, org.Stall1ID, 10, 1000)

	// Opening stock on an existing balance averages the cost.
	in := ledger.ImportStock{RawMaterialID: rm, Qty: 10, UnitCost: 3000, UserID: e.Staff.UserID, WarehouseID: &org.Stall1ID}
	if err := ledger.AddOpeningStockFromImport(e.Ctx, e.Tx, in, now); err != nil {
		t.Fatal(err)
	}
	var state string
	e.Scalar(&state, `SELECT i.qty_available::float8::text || ' ' || i.unit_cost::float8::text || ' ' || m.tipe || ' ' || m.qty_before::float8::text ||
		' ' || m.total_cost::float8::text || ' ' || m.reference_number || ' ' || m.alasan
		FROM inventory.inventory i JOIN inventory.inventory_movements m ON m.inventory_id = i.id WHERE i.warehouse_id = $1 AND i.raw_material_id = $2`,
		org.Stall1ID, rm)
	if state != "20 2000 in 10 20000 "+rm[:8]+" Opening stock from raw material import ("+rm[:8]+")" {
		t.Fatalf("opening stock %q", state)
	}

	// Setting a stall without a balance to 0 writes nothing; a positive
	// quantity opens one at the file's cost.
	in = ledger.ImportStock{RawMaterialID: rm, Qty: 0, UnitCost: 500, UserID: e.Staff.UserID, WarehouseID: &org.Stall2ID, MaterialKode: "RMI"}
	if err := ledger.SetStockFromImport(e.Ctx, e.Tx, in, now); err != nil {
		t.Fatal(err)
	}
	var balances int
	e.Scalar(&balances, `SELECT count(*) FROM inventory.inventory WHERE warehouse_id = $1 AND raw_material_id = $2`, org.Stall2ID, rm)
	if balances != 0 {
		t.Fatal("a zero quantity must not open a balance")
	}
	in.Qty = 4
	if err := ledger.SetStockFromImport(e.Ctx, e.Tx, in, now); err != nil {
		t.Fatal(err)
	}
	e.Scalar(&state, `SELECT i.qty_available::float8::text || ' ' || i.unit_cost::float8::text || ' ' || m.tipe || ' ' || m.alasan
		FROM inventory.inventory i JOIN inventory.inventory_movements m ON m.inventory_id = i.id WHERE i.warehouse_id = $1 AND i.raw_material_id = $2`,
		org.Stall2ID, rm)
	if state != "4 500 in Opening stock from import (RMI)" {
		t.Fatalf("new balance %q", state)
	}

	in.Qty = -1
	if err := ledger.SetStockFromImport(e.Ctx, e.Tx, in, now); err == nil || err.Error() != "Stock quantity cannot be negative" {
		t.Fatalf("negative: %v", err)
	}
}
