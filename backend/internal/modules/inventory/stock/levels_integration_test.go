package stock_test

import (
	"net/http"
	"strings"
	"testing"

	"nuhabit/backend/internal/modules/inventory/ledger"
	"nuhabit/backend/internal/modules/inventory/stock"
)

func TestInventoryViewAndMovements(t *testing.T) {
	e := setup(t)
	rm := e.RawMaterial(e.org, "RMT-"+e.org.BranchID[:4], "Gula Pasir Test", e.unitKg, "", 1)
	inv := e.Stock(e.org, rm, e.org.MainID, 12.5, 15000)

	out := e.Call("GET", "/api/inventory?search=Gula%20Pasir%20Test&limit=5", nil, http.StatusOK)
	if out["message"] != "Inventory retrieved" {
		t.Fatalf("message %v", out["message"])
	}
	e.jsonEq(out["pagination"], `{"page":1,"limit":5,"total":1}`)
	row := obj(e.list(out, "data")[0])
	if row["qty_available"] != "12.500" || row["unit_cost"] != "15000.00" || row["material_kode"] != "RMT-"+e.org.BranchID[:4] {
		t.Fatalf("row %v", row)
	}

	// NaN paging reaches PostgreSQL like the TS shim and fails there.
	e.Fail("GET", "/api/inventory?page=abc", nil, http.StatusBadRequest, "Format data tidak valid")

	if err := ledger.AddFromGrn(e.Ctx, e.Tx, ledger.GrnReceipt{RawMaterialID: rm, Qty: 2, UnitCost: 16000, GrnID: e.org.BranchID,
		GrnNumber: "GRN-T-1", UserID: e.Staff.UserID, WarehouseID: &e.org.MainID}, fixedNow); err != nil {
		t.Fatal(err)
	}
	out = e.Call("GET", "/api/inventory/"+inv+"/movements", nil, http.StatusOK)
	e.jsonEq(out["pagination"], `{"page":1,"limit":25,"total":1}`)
	mv := obj(e.list(out, "data")[0])
	if mv["tipe"] != "in" || mv["jumlah"] != "2.000" || mv["qty_after"] != "14.500" || mv["reference_type"] != "grn" {
		t.Fatalf("movement %v", mv)
	}
	e.Fail("GET", "/api/inventory/not-a-uuid/movements", nil, http.StatusBadRequest, "Format data tidak valid")
}

func TestBatchesAndExpiry(t *testing.T) {
	e := setup(t)
	rm := e.RawMaterial(e.org, "RMB-1"+e.org.BranchID[:3], "Susu Batch", e.unitKg, "", 1)
	e.Stock(e.org, rm, e.org.Stall1ID, 0, 0)
	for _, b := range []struct{ no, exp string }{{"B-NEAR", "2026-10-10"}, {"B-OLD", "2026-10-01"}, {"B-FAR", "2027-01-01"}} {
		no, exp := b.no, b.exp
		if err := ledger.AddFromGrn(e.Ctx, e.Tx, ledger.GrnReceipt{RawMaterialID: rm, Qty: 4, UnitCost: 1000, GrnID: e.org.CompanyID,
			GrnNumber: "GRN-" + no, UserID: e.Staff.UserID, WarehouseID: &e.org.Stall1ID, BatchNumber: &no, ExpiryDate: &exp}, fixedNow); err != nil {
			t.Fatal(err)
		}
	}
	out := e.Call("GET", "/api/inventory/batches?raw_material_id="+rm+"&warehouse_id="+e.org.Stall1ID, nil, http.StatusOK)
	batches := e.list(out, "data")
	if len(batches) != 3 || obj(batches[0])["batch_number"] != "B-OLD" || obj(batches[0])["qty_remaining"] != 4.0 ||
		obj(batches[0])["expiry_date"] != "2026-10-01" {
		t.Fatalf("batches %v", batches)
	}
	out = e.Fail("GET", "/api/inventory/batches?raw_material_id=x", nil, http.StatusBadRequest, "raw_material_id dan warehouse_id wajib")
	e.jsonEq(out["details"], `{"raw_material_id":["Invalid string: must match pattern /^[0-9a-f-]{36}$/i"],"warehouse_id":["Invalid input: expected string, received undefined"]}`)

	// Today in Jakarta is 2026-10-04; the default horizon is 30 days.
	out = e.Call("GET", "/api/inventory/expiry?search=Susu%20Batch", nil, http.StatusOK)
	e.jsonEq(out["meta"], `{"today":"2026-10-04","horizon":"2026-11-03"}`)
	rows := e.list(out, "data")
	if len(rows) != 2 || obj(rows[0])["days_left"] != -3.0 || obj(rows[1])["value_at_risk"] != 4000.0 {
		t.Fatalf("expiry rows %v", rows)
	}
	e.jsonEq(out["summary"], `{"nearBatches":1,"nearQty":4,"nearValue":4000,"expiredBatches":1,"expiredQty":4,"expiredValue":4000}`)
	out = e.Call("GET", "/api/inventory/expiry?status=expired&search=Susu%20Batch", nil, http.StatusOK)
	if len(e.list(out, "data")) != 1 {
		t.Fatalf("expired %v", out["data"])
	}
	out = e.Fail("GET", "/api/inventory/expiry?days=1.5&status=x", nil, http.StatusBadRequest, "Filter tidak valid")
	e.jsonEq(out["details"], `{"days":["Invalid input: expected int, received number"],"status":["Invalid option: expected one of \"all\"|\"near\"|\"expired\""]}`)
}

func TestMaterialsAndLowStock(t *testing.T) {
	e := setup(t)
	e.ScopeStaff("branch", e.org)
	rm := e.RawMaterial(e.org, "RML-"+e.org.BranchID[:4], "Kopi Low", e.unitKg, e.unitGr, 1000)
	e.Stock(e.org, rm, e.org.MainID, 2, 50)
	out := e.Call("GET", "/api/inventory/materials", nil, http.StatusOK)
	e.jsonEq(out["data"], `[{"id":"`+rm+`","kode":"RML-`+e.org.BranchID[:4]+`","nama":"Kopi Low","satuan":"Gram"}]`)

	supplier := "Pemasok A"
	date := "2026-09-30"
	e.procure[rm] = stock.LastPurchase{SupplierID: &e.org.CompanyID, SupplierName: &supplier, TanggalPO: &date}
	out = e.Call("GET", "/api/inventory/low-stock", nil, http.StatusOK)
	var item map[string]any
	for _, d := range e.list(out, "data") {
		if obj(d)["raw_material_id"] == rm {
			item = obj(d)
		}
	}
	// stok_minimum 5 (fixture), on hand 2, no maximum → minimum buffer ceil(3 × 1.5).
	if item == nil || item["shortage_qty"] != 3.0 || item["suggested_order_qty"] != 5.0 || item["suggestion_basis"] != "minimum_buffer" ||
		item["estimated_cost"] != 250.0 || item["supplier_name"] != "Pemasok A" || item["stock_status"] != "low_stock" {
		t.Fatalf("low stock item %v", item)
	}
	if out["message"] != "Low stock report retrieved" {
		t.Fatal(out["message"])
	}
	delete(e.procure, rm)
	out = e.Call("GET", "/api/inventory/low-stock?status=low_stock", nil, http.StatusOK)
	for _, d := range e.list(out, "data") {
		if obj(d)["raw_material_id"] == rm {
			if _, has := obj(d)["supplier_name"]; has {
				t.Fatalf("supplier_name must be omitted when null: %v", d)
			}
		}
	}
}

func TestMovementsJSONAndCSV(t *testing.T) {
	e := setup(t)
	rm := e.RawMaterial(e.org, "RMM-"+e.org.BranchID[:4], "Teh Mutasi", e.unitKg, "", 1)
	if err := ledger.AddFromGrn(e.Ctx, e.Tx, ledger.GrnReceipt{RawMaterialID: rm, Qty: 3, UnitCost: 2000, GrnID: e.org.HoldingID,
		GrnNumber: "GRN-MUT", UserID: e.Staff.UserID, WarehouseID: &e.org.MainID}, fixedNow); err != nil {
		t.Fatal(err)
	}
	out := e.Call("GET", "/api/inventory/movements?raw_material_id="+rm+"&warehouse_id=all&tipe=", nil, http.StatusOK)
	e.jsonEq(out["meta"], `{"page":1,"limit":50,"total":1,"totalPages":1}`)
	row := obj(e.list(out, "data")[0])
	if row["direction"] != "in" || row["jumlah"] != 3.0 || row["reference_number"] != "GRN-MUT" || row["created_by_name"] != e.Staff.FullName {
		t.Fatalf("movement %v", row)
	}
	rec := e.Do("GET", "/api/inventory/movements?format=csv&raw_material_id="+rm, nil)
	if rec.Code != 200 || rec.Header().Get("Content-Type") != "text/csv; charset=utf-8" ||
		rec.Header().Get("Content-Disposition") != `attachment; filename="mutasi-stok-2026-10-04.csv"` {
		t.Fatalf("csv %d %v", rec.Code, rec.Header())
	}
	lines := strings.Split(strings.TrimPrefix(rec.Body.String(), "\ufeff"), "\n")
	if lines[0] != `"Waktu","Kode","Bahan Baku","Gudang","Tipe","Qty","Satuan","Stok Sebelum","Stok Sesudah","Biaya Satuan","Total Biaya","Sumber","No. Referensi","Batch","Keterangan","Oleh"` {
		t.Fatalf("header %q", lines[0])
	}
	if !strings.Contains(lines[1], `,"Masuk",3,"Kilogram",0,3,2000,6000,"Penerimaan (GRN)","GRN-MUT",`) {
		t.Fatalf("csv row %q", lines[1])
	}
	out = e.Fail("GET", "/api/inventory/movements?limit=500&date_from=2026-1-1", nil, http.StatusBadRequest, "Filter tidak valid")
	e.jsonEq(out["details"], `{"date_from":["Invalid string: must match pattern /^\\d{4}-\\d{2}-\\d{2}$/"],"limit":["Too big: expected number to be <=200"]}`)
}

func TestRawMaterialStockBranchWarehouseAndLegacy(t *testing.T) {
	e := setup(t)
	rm := e.RawMaterial(e.org, "RMS-"+e.org.BranchID[:4], "Tepung Stall", e.unitKg, e.unitGr, 1000)
	e.Stock(e.org, rm, e.org.MainID, 10, 100)
	e.Stock(e.org, rm, e.org.Stall1ID, 30, 200)

	// Unscoped without a stall: the legacy aggregate view.
	out := e.Call("GET", "/api/inventory/raw-materials?search=Tepung%20Stall", nil, http.StatusOK)
	if out["message"] != "Raw material stock retrieved" || len(e.list(out, "data")) != 1 {
		t.Fatalf("legacy %v", out)
	}

	// Explicit warehouse.
	out = e.Call("GET", "/api/inventory/raw-materials?warehouse_id="+e.org.Stall1ID, nil, http.StatusOK)
	e.jsonEq(out["data"], `[{"id":"`+rm+`","kode":"RMS-`+e.org.BranchID[:4]+`","nama":"Tepung Stall","kategori":"Bahan","qty_onhand":30,
		"min_stock":5,"max_stock":0,"unit_cost":200,"avg_cost":200,"total_value":6000,"status_stok":"AMAN","satuan":"Kilogram",
		"satuan_besar_nama":"Kilogram","satuan_kecil_nama":"Gram","konversi_factor":1000,"harga_beli":1000,
		"warehouse_id":"`+e.org.Stall1ID+`","warehouse_nama":"Stall 1"}]`)

	// Branch scope aggregates the branch's warehouses at weighted cost.
	e.ScopeStaff("branch", e.org)
	out = e.Call("GET", "/api/inventory/raw-materials", nil, http.StatusOK)
	row := obj(e.list(out, "data")[0])
	if row["qty_onhand"] != 40.0 || row["unit_cost"] != 175.0 || row["warehouse_id"] != nil {
		t.Fatalf("branch %v", row)
	}
	e.jsonEq(out["pagination"], `{"page":1,"limit":20,"total":1}`)

	out = e.Fail("GET", "/api/inventory/raw-materials?page=", nil, http.StatusBadRequest, "Filter tidak valid")
	e.jsonEq(out["details"], `{"page":["Too small: expected number to be >=1"]}`)
	other := e.NewOrg()
	e.Fail("GET", "/api/inventory/raw-materials?warehouse_id="+other.Stall1ID, nil, http.StatusBadRequest, "Gudang tidak valid atau tidak diizinkan")
}
