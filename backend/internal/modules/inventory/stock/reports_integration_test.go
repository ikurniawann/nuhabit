package stock_test

import (
	"net/http"
	"testing"
)

func (e *env) movement(table, itemColumn, itemID, inventoryID, warehouseID, tipe string, qty, before, after float64, unitCost any, createdAt string) string {
	e.Helper()
	return e.ID(`INSERT INTO inventory.`+table+` (inventory_id, `+itemColumn+`, warehouse_id, tipe, jumlah, qty_before, qty_after,
		unit_cost, total_cost, reference_type, reference_number, alasan, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULL, 'manual', 'REF-1', NULL, $9) RETURNING id::text`,
		inventoryID, itemID, warehouseID, tipe, qty, before, after, unitCost, createdAt)
}

func TestStockCardRawMaterial(t *testing.T) {
	e := setup(t)
	rm := e.RawMaterial(e.org, "RSC-"+e.org.BranchID[:4], "Gula Kartu", e.unitKg, "", 1)
	inv := e.Stock(e.org, rm, e.org.MainID, 7, 1500)
	in := e.movement("inventory_movements", "raw_material_id", rm, inv, e.org.MainID, "in", 10, 0, 10, 1200.0, "2026-09-01T02:00:00Z")
	adj := e.movement("inventory_movements", "raw_material_id", rm, inv, e.org.MainID, "adjustment", 3, 10, 7, nil, "2026-09-10T02:00:00Z")

	out := e.Call("GET", "/api/purchasing/reports/stock-card?material_id="+rm, nil, http.StatusOK)
	data := obj(out["data"])
	if data["item_type"] != "raw_material" || obj(data["selected_item"])["id"] != rm || obj(data["selected_material"])["nama"] != "Gula Kartu" {
		t.Fatalf("selected %v", data["selected_item"])
	}
	e.jsonEq(data["selected_item"], `{"id":"`+rm+`","kode":"RSC-`+e.org.BranchID[:4]+`","nama":"Gula Kartu","kategori":"Bahan",
		"satuan":"Kilogram","lokasi_rak":"-","qty_onhand":7,"avg_cost":1500,"min_stock":0,"max_stock":0,"status_stok":"AMAN",
		"warehouse_id":null,"warehouse_name":null}`)
	movements := e.list(data, "movements")
	if len(movements) != 2 || obj(movements[0])["id"] != in || obj(movements[1])["id"] != adj {
		t.Fatalf("movements %v", movements)
	}
	// No recorded cost: the active inventory unit cost; total = |qty| x unit.
	e.jsonEq(movements[1], `{"id":"`+adj+`","item_id":"`+rm+`","raw_material_id":"`+rm+`","material_kode":"RSC-`+e.org.BranchID[:4]+`",
		"material_nama":"Gula Kartu","material_kategori":"Bahan","item_kode":"RSC-`+e.org.BranchID[:4]+`","item_nama":"Gula Kartu",
		"item_kategori":"Bahan","tipe":"adjustment","jumlah":3,"qty_before":10,"qty_after":7,"unit_cost":1500,"total_cost":4500,
		"reference_type":"manual","reference_id":null,"reference_number":"REF-1","alasan":"-","catatan":"",
		"created_at":"2026-09-10T02:00:00.000Z","warehouse_id":"`+e.org.MainID+`"}`)
	e.jsonEq(data["summary"], `{"opening_balance":0,"closing_balance":7,"total_in":10,"total_out":0,"total_adjustment_in":0,
		"total_adjustment_out":3,"total_return":0,"total_transfer":0,"total_value":16500,"movement_count":2}`)

	// date_from: the opening balance is the last qty_after before it.
	out = e.Call("GET", "/api/purchasing/reports/stock-card?item_id="+rm+"&date_from=2026-09-05&tipe=adjustment&limit=5", nil, http.StatusOK)
	data = obj(out["data"])
	if len(e.list(data, "movements")) != 1 || obj(data["summary"])["opening_balance"] != 10.0 {
		t.Fatalf("from date %v", data["summary"])
	}

	// An explicit stall keeps only materials stocked there, and the active
	// stall applies when none is given.
	out = e.Call("GET", "/api/purchasing/reports/stock-card?material_id="+rm+"&warehouse_id="+e.org.Stall1ID, nil, http.StatusOK)
	data = obj(out["data"])
	if len(e.list(data, "items")) != 0 || data["selected_item"] != nil || len(e.list(data, "movements")) != 0 {
		t.Fatalf("stall 1 %v", data)
	}
	e.Exec(`UPDATE configuration.users SET can_switch_stall = true WHERE id = $1`, e.Staff.UserID)
	e.ActiveStall(e.org.MainID)
	out = e.Call("GET", "/api/purchasing/reports/stock-card?material_id="+rm, nil, http.StatusOK)
	if items := e.list(obj(out["data"]), "items"); len(items) == 0 {
		t.Fatal("main stall has the material")
	}
	e.Cookies = nil

	// A movement of a material outside the list (search) still gets its name.
	out = e.Call("GET", "/api/purchasing/reports/stock-card?material_id="+rm+"&search=zz-tidak-ada", nil, http.StatusOK)
	data = obj(out["data"])
	if len(e.list(data, "items")) != 0 || obj(e.list(data, "movements")[0])["material_nama"] != "Gula Kartu" {
		t.Fatalf("placeholder %v", data)
	}

	out = e.Fail("GET", "/api/purchasing/reports/stock-card?item_type=service&limit=0", nil, http.StatusBadRequest, "Invalid query params")
	e.jsonEq(out["details"], `[{"code":"invalid_value","path":["item_type"],"message":"Invalid option: expected one of \"raw_material\"|\"product\""},
		{"code":"too_small","path":["limit"],"message":"Too small: expected number to be >=1"}]`)
}

func TestStockCardProductSkipsVariantRows(t *testing.T) {
	e := setup(t)
	product := e.Product(e.org, e.org.Stall1ID, "PSC-"+e.org.BranchID[:4], "Kaos Kartu", 25000)
	e.Call("POST", "/api/inventory/finished-goods/adjustment", map[string]any{"product_id": product, "qty_actual": 4}, http.StatusOK)
	// A per-variant detail row must not count twice.
	posProduct := e.ID(`INSERT INTO pos.pos_products (sku, name) VALUES ('PSC-'||$1, 'Kaos') RETURNING id::text`, e.org.BranchID[:8])
	sku := e.ID(`INSERT INTO pos.pos_product_skus (product_id, sku, name) VALUES ($1, 'PSC-M-'||$2, 'Kaos M') RETURNING id::text`, posProduct, e.org.BranchID[:8])
	e.Exec(`INSERT INTO inventory.finished_goods_movements (inventory_id, product_id, warehouse_id, tipe, jumlah, qty_before, qty_after, pos_sku_id)
		SELECT inventory_id, product_id, warehouse_id, tipe, jumlah, 0, jumlah, $2 FROM inventory.finished_goods_movements WHERE product_id = $1`, product, sku)

	out := e.Call("GET", "/api/purchasing/reports/stock-card?item_type=product&product_id="+product, nil, http.StatusOK)
	data := obj(out["data"])
	movements := e.list(data, "movements")
	if data["item_type"] != "product" || len(movements) != 1 || obj(movements[0])["item_nama"] != "Kaos Kartu" {
		t.Fatalf("movements %v", movements)
	}
	summary := obj(data["summary"])
	if summary["total_adjustment_in"] != 4.0 || summary["closing_balance"] != 4.0 || summary["movement_count"] != 1.0 {
		t.Fatalf("summary %v", summary)
	}
	if obj(data["selected_item"])["lokasi_rak"] != "Stall 1" || obj(data["selected_item"])["warehouse_id"] != e.org.Stall1ID {
		t.Fatalf("selected %v", data["selected_item"])
	}
}

func TestInventoryValuation(t *testing.T) {
	e := setup(t)
	rm := e.RawMaterial(e.org, "RIV-"+e.org.BranchID[:4], "Kardus Nilai", e.unitKg, "", 1)
	e.Exec(`UPDATE item.raw_materials SET kategori = 'KEMASAN' WHERE id = $1`, rm)
	e.Stock(e.org, rm, e.org.Stall1ID, 4, 2500)

	find := func(out map[string]any) map[string]any {
		for _, row := range e.list(out, "data") {
			if obj(row)["id"] == rm {
				return obj(row)
			}
		}
		return nil
	}
	out := e.Call("GET", "/api/purchasing/reports/inventory-valuation", nil, http.StatusOK)
	row := find(out)
	if row == nil || row["qty_onhand"] != 4.0 || row["avg_cost"] != 2500.0 || row["unit_cost"] != 2500.0 || row["total_value"] != 10000.0 ||
		row["min_stock"] != 0.0 || row["satuan"] != "Kilogram" || row["lokasi_rak"] != "-" || row["kode"] != "RIV-"+e.org.BranchID[:4] {
		t.Fatalf("row %v", row)
	}
	summary := obj(out["summary"])
	if summary["total_items"] != float64(len(e.list(out, "data"))) {
		t.Fatalf("summary %v", summary)
	}
	labelled := false
	for _, c := range e.list(summary, "by_category") {
		labelled = labelled || obj(c)["kategori"] == "Kemasan"
	}
	if !labelled {
		t.Fatalf("by_category %v", summary["by_category"])
	}

	// The active stall switches to the per-warehouse view (materials on a
	// stall product's BOM).
	product := e.Product(e.org, e.org.Stall1ID, "PIV-"+e.org.BranchID[:4], "Kopi Nilai", 9000)
	e.Exec(`INSERT INTO manufacturing.bom_items (product_id, raw_material_id, qty_required) VALUES ($1, $2, 1)`, product, rm)
	e.Exec(`UPDATE configuration.users SET can_switch_stall = true WHERE id = $1`, e.Staff.UserID)
	e.ActiveStall(e.org.Stall1ID)
	out = e.Call("GET", "/api/purchasing/reports/inventory-valuation", nil, http.StatusOK)
	if row := find(out); row == nil || row["warehouse_id"] != e.org.Stall1ID || len(e.list(out, "data")) != 1 {
		t.Fatalf("stall rows %v", out["data"])
	}
	e.jsonEq(obj(out["summary"]), `{"total_value":10000,"total_items":1,"by_category":[{"kategori":"Kemasan","total_value":10000,"item_count":1}]}`)
}
