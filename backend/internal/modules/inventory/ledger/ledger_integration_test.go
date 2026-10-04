package ledger_test

import (
	"errors"
	"testing"
	"time"

	"nuhabit/backend/internal/modules/inventory/kit/kittest"
	"nuhabit/backend/internal/modules/inventory/ledger"
)

// The purchase return functions run inside procurement's approval
// transaction (internal/app/adapters_procurement.go).
func TestPurchaseReturns(t *testing.T) {
	e := kittest.Setup(t, kittest.Menus, nil)
	org := e.NewOrg()
	now := time.Now()
	rm := e.RawMaterial(org, "RMR-"+org.BranchID[:4], "Minyak", e.Unit("L", "Liter"), "", 1)
	e.Stock(org, rm, org.Stall1ID, 5, 20000)
	supplier := e.ID(`INSERT INTO purchasing.suppliers (kode, nama_supplier) VALUES ('SUPR-'||$1, 'Supplier') RETURNING id::text`, org.BranchID[:8])
	returnID := e.ID(`INSERT INTO purchasing.purchase_returns (return_number, reason_type, supplier_id) VALUES ('RTN-'||$1, 'damaged', $2)
		RETURNING id::text`, org.BranchID[:8], supplier)
	ret := ledger.PurchaseReturn{RawMaterialID: rm, Qty: 2, ReturnID: returnID, ReturnNumber: "RTN-1", WarehouseID: &org.Stall1ID,
		UserID: e.Staff.UserID, ConditionNotes: kittest.Ptr("bocor")}
	if err := ledger.ReduceForPurchaseReturn(e.Ctx, e.Tx, ret, now); err != nil {
		t.Fatal(err)
	}
	var qty, cost float64
	var alasan string
	e.Scalar(&qty, `SELECT qty_available FROM inventory.inventory WHERE raw_material_id = $1`, rm)
	e.Scalar(&cost, `SELECT unit_cost FROM inventory.inventory_movements WHERE return_id = $1`, returnID)
	e.Scalar(&alasan, `SELECT alasan FROM inventory.inventory_movements WHERE return_id = $1`, returnID)
	if qty != 3 || cost != 20000 || alasan != "Purchase return RTN-1: bocor" {
		t.Fatalf("qty %v cost %v alasan %q", qty, cost, alasan)
	}
	ret.Qty = 10
	if err := ledger.ReduceForPurchaseReturn(e.Ctx, e.Tx, ret, now); !errors.Is(err, ledger.ErrInsufficientReturnStock) {
		t.Fatalf("short: %v", err)
	}

	product := e.Product(org, org.Stall1ID, "PRR-"+org.BranchID[:4], "Kaos", 40000)
	if err := ledger.ReduceProductForPurchaseReturn(e.Ctx, e.Tx, ledger.PurchaseReturn{ProductID: product, Qty: 1, UnitCost: 40000,
		ReturnID: returnID, ReturnNumber: "RTN-2", UserID: e.Staff.UserID}, now); !errors.Is(err, ledger.ErrInsufficientProductReturnStock) {
		t.Fatalf("product short: %v", err)
	}
}

func TestAdjustOnOrder(t *testing.T) {
	e := kittest.Setup(t, kittest.Menus, nil)
	org := e.NewOrg()
	rm := e.RawMaterial(org, "RMO-"+org.BranchID[:4], "Gula", e.Unit("KG", "Kilogram"), "", 1)
	now := time.Now()
	if err := ledger.AdjustOnOrder(e.Ctx, e.Tx, rm, -3, nil, now); err != nil {
		t.Fatal(err)
	}
	var rows int
	e.Scalar(&rows, `SELECT count(*) FROM inventory.inventory WHERE raw_material_id = $1`, rm)
	if rows != 0 {
		t.Fatal("a release without a balance creates nothing")
	}
	for _, d := range []float64{5, -8} {
		if err := ledger.AdjustOnOrder(e.Ctx, e.Tx, rm, d, nil, now); err != nil {
			t.Fatal(err)
		}
	}
	var onOrder float64
	var warehouse string
	e.Scalar(&onOrder, `SELECT qty_on_order FROM inventory.inventory WHERE raw_material_id = $1`, rm)
	e.Scalar(&warehouse, `SELECT warehouse_id::text FROM inventory.inventory WHERE raw_material_id = $1`, rm)
	if onOrder != 0 || warehouse != org.MainID {
		t.Fatalf("on order %v at %s", onOrder, warehouse)
	}
}
