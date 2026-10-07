package production_test

import (
	"net/http"
	"testing"
	"time"

	"nuhabit/backend/internal/contracts/procurement"
	"nuhabit/backend/internal/modules/inventory/kit/kittest"
	"nuhabit/backend/internal/modules/inventory/ledger"
	"nuhabit/backend/internal/modules/inventory/production"
	"nuhabit/backend/internal/modules/inventory/stock"
)

// Additional purchase costs join the stock value of the raw materials they
// brought in: the weighted average cost, the production order cost and an
// outbox event for the journals. A deleted cost takes its value back, and a
// PO cost recorded before a receipt lands when that receipt posts stock.
func TestLandedCostCapitalization(t *testing.T) {
	now := time.Date(2026, 10, 5, 3, 0, 0, 0, time.UTC)
	e := kittest.Setup(t, kittest.Menus, func() time.Time { return now })
	org := e.NewOrg()
	e.ScopeStaff("branch", org)
	kg := e.Unit("KG", "Kilogram")
	rm := e.RawMaterial(org, "RMC-"+org.BranchID[:4], "Beras", kg, "", 1)
	product := e.Product(org, org.Stall1ID, "PRC-"+org.BranchID[:4], "Nasi", 5000)
	e.Exec(`INSERT INTO manufacturing.bom_items (product_id, raw_material_id, qty_required, waste_factor) VALUES ($1, $2, 0.2, 0.1)`, product, rm)

	// A PO for 20 kg at 12000; the first GRN receives and posts 10 kg.
	supplier := e.ID(`INSERT INTO purchasing.suppliers (kode, nama_supplier) VALUES ('SLC-'||$1, 'Supplier') RETURNING id::text`, org.BranchID[:8])
	po := e.ID(`INSERT INTO purchasing.purchase_orders (nomor_po, supplier_id, company_id, branch_id) VALUES ($1, $2, $3, $4) RETURNING id::text`,
		"PO-LC-"+org.BranchID[:6], supplier, org.CompanyID, org.BranchID)
	poItem := e.ID(`INSERT INTO purchasing.purchase_order_items (purchase_order_id, raw_material_id, qty_ordered, harga_satuan, satuan_id)
		VALUES ($1, $2, 20, 12000, $3) RETURNING id::text`, po, rm, kg)
	receive := func(number string) string {
		grn := e.ID(`INSERT INTO purchasing.grn (nomor_grn, purchase_order_id, supplier_id, company_id, branch_id) VALUES ($1, $2, $3, $4, $5) RETURNING id::text`,
			number+"-"+org.BranchID[:6], po, supplier, org.CompanyID, org.BranchID)
		e.Exec(`INSERT INTO purchasing.grn_items (grn_id, purchase_order_item_id, raw_material_id, qty_diterima, qty_qc_posted, satuan_id, warehouse_id)
			VALUES ($1, $2, $3, 10, 10, $4, $5)`, grn, poItem, rm, kg, org.MainID)
		return grn
	}
	grn := receive("GRN-LC1")
	if err := ledger.AddFromGrn(e.Ctx, e.Tx, ledger.GrnReceipt{RawMaterialID: rm, Qty: 10, UnitCost: 12000, GrnID: grn, GrnNumber: "GRN-LC1",
		UserID: e.Staff.UserID, WarehouseID: &org.MainID}, now); err != nil {
		t.Fatal(err)
	}
	receipts := fakeReceipts{numbers: map[string]string{"GRN:" + grn: "GRN-LC1", "PO:" + po: "PO-LC"}}
	e.Mount(production.Routes(e.Env, production.Ports{Pos: &fakePos{stock: map[string]float64{}}, Receipts: receipts}))
	unitCost := func() float64 {
		var cost float64
		e.Scalar(&cost, `SELECT unit_cost::float8 FROM inventory.inventory WHERE raw_material_id = $1`, rm)
		return cost
	}
	applied := func(key string) (capitalized, expensed float64) {
		e.Scalar(&capitalized, `SELECT COALESCE(sum((payload->>'capitalized')::float8), 0) FROM platform.outbox_events
			WHERE topic = 'inventory.landed_cost.applied' AND payload->>'cost_id' = $1`, key)
		e.Scalar(&expensed, `SELECT COALESCE(sum((payload->>'expensed')::float8), 0) FROM platform.outbox_events
			WHERE topic = 'inventory.landed_cost.applied' AND payload->>'cost_id' = $1`, key)
		return
	}

	// 12000 freight on the GRN's 120000: 1200 more per kg on hand.
	cost := obj(e.Call("POST", "/api/purchasing/cogs/additional-cost", map[string]any{"reference_type": "GRN", "reference_id": grn,
		"tipe_biaya": "freight", "jumlah": 12000}, http.StatusCreated)["data"])["id"].(string)
	if got := unitCost(); got != 13200 {
		t.Fatalf("unit cost after freight = %v", got)
	}
	if capitalized, expensed := applied(cost); capitalized != 12000 || expensed != 0 {
		t.Fatalf("event capitalized %v expensed %v", capitalized, expensed)
	}
	// The estimate no longer adds what the stock value already carries.
	c := obj(e.Call("GET", "/api/purchasing/cogs/product/"+product, nil, http.StatusOK)["data"])
	if c["total_bom_cost"] != 2904.0 || c["total_additional_cost"] != 0.0 || c["hpp_per_unit"] != 3194.4 {
		t.Fatalf("cogs after capitalization %v", c)
	}
	// A production order costs its materials at the landed average: 1.1 kg × 13200.
	order := obj(e.Call("POST", "/api/purchasing/production/orders", map[string]any{"product_id": product, "planned_qty": 5}, http.StatusCreated)["data"])
	if order["planned_material_cost"] != "14520.00" {
		t.Fatalf("production order cost %v", order["planned_material_cost"])
	}

	// Deleting the cost takes its value back out of the stock.
	e.Call("DELETE", "/api/purchasing/cogs/additional-cost/"+cost, nil, http.StatusOK)
	if got := unitCost(); got != 12000 {
		t.Fatalf("unit cost after delete = %v", got)
	}
	if capitalized, _ := applied(cost); capitalized != 0 {
		t.Fatalf("net capitalized after delete %v", capitalized)
	}

	// 5000 on the PO (240000 ordered): the posted half carries 2500 now, the
	// second receipt carries the rest when it posts stock.
	poCost := obj(e.Call("POST", "/api/purchasing/cogs/additional-cost", map[string]any{"reference_type": "PO", "reference_id": po,
		"tipe_biaya": "duty", "jumlah": 5000}, http.StatusCreated)["data"])["id"].(string)
	if got := unitCost(); got != 12250 {
		t.Fatalf("unit cost after PO duty = %v", got)
	}
	second := receive("GRN-LC2")
	if err := stock.ApplyGrnStock(e.Ctx, e.Tx, procurement.GrnStockReceived{GrnID: second, GrnNumber: "GRN-LC2", UserID: e.Staff.UserID,
		Lines: []procurement.GrnStockLine{{RawMaterialID: &rm, Qty: 10, UnitCost: 12000, WarehouseID: &org.MainID}}}, now); err != nil {
		t.Fatal(err)
	}
	// (10 × 12250 + 10 × 12000 + 2500) / 20
	if got := unitCost(); got != 12250 {
		t.Fatalf("unit cost after the second receipt = %v", got)
	}
	if capitalized, _ := applied(poCost); capitalized != 5000 {
		t.Fatalf("PO duty capitalized %v", capitalized)
	}
}
