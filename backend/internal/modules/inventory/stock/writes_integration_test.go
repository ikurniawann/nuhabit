package stock_test

import (
	"net/http"
	"strings"
	"testing"

	"nuhabit/backend/internal/modules/inventory/ledger"
	"nuhabit/backend/internal/modules/inventory/stock"
)

func TestFinishedGoodsListAndAdjustment(t *testing.T) {
	e := setup(t)
	product := e.Product(e.org, e.org.Stall1ID, "PRD-"+e.org.BranchID[:4], "Kaos Merch", 40000)
	e.skus.byProduct[product] = []stock.Sku{{ID: e.org.HoldingID, Sku: "KAOS-M", Name: "Kaos M", Options: []byte(`{"size":"M"}`), StockQuantity: 3}}

	out := e.Call("POST", "/api/inventory/finished-goods/adjustment", map[string]any{"product_id": product, "qty_actual": 7, "notes": "hitung"}, http.StatusOK)
	if out["message"] != "Stok produk berhasil disesuaikan" {
		t.Fatalf("message %v", out["message"])
	}
	e.jsonEq(out["adjustment"], `{"product_id":"`+product+`","product_kode":"PRD-`+e.org.BranchID[:4]+`","product_nama":"Kaos Merch",
		"qty_before":0,"qty_after":7,"qty_diff":7,"notes":"hitung"}`)
	data := obj(out["data"])
	if data["qty_available"] != "7.000" || data["unit_cost"] != "40000.00" {
		t.Fatalf("data %v", data)
	}
	if n := e.num(`SELECT count(*) FROM inventory.finished_goods_movements WHERE product_id = $1 AND reference_type = 'manual_adjustment'
		AND jumlah = 7 AND warehouse_id = $2`, product, e.org.Stall1ID); n != 1 {
		t.Fatalf("movements %v", n)
	}
	out = e.Call("POST", "/api/inventory/finished-goods/adjustment", map[string]any{"product_id": product, "qty_actual": 7}, http.StatusOK)
	if out["message"] != "Stok tidak berubah" {
		t.Fatal(out["message"])
	}
	e.Fail("POST", "/api/inventory/finished-goods/adjustment", map[string]any{"product_id": e.org.MainID, "qty_actual": 1}, http.StatusNotFound, "Produk tidak ditemukan")
	out = e.Fail("POST", "/api/inventory/finished-goods/adjustment", map[string]any{"product_id": "x", "qty_actual": -1}, http.StatusBadRequest, "Validation failed")
	e.jsonEq(out["details"], `[{"code":"invalid_format","path":["product_id"],"message":"Produk wajib dipilih"},
		{"code":"too_small","path":["qty_actual"],"message":"Stok aktual minimal 0"}]`)

	other := e.NewOrg()
	e.ScopeStaff("branch", other)
	e.Fail("POST", "/api/inventory/finished-goods/adjustment", map[string]any{"product_id": product, "qty_actual": 1}, http.StatusForbidden, "Produk tidak tersedia untuk scope Anda")
	e.ScopeStaff("", e.org)

	out = e.Call("GET", "/api/inventory/finished-goods?search=Kaos%20Merch&warehouse_id=all", nil, http.StatusOK)
	row := obj(e.list(out, "data")[0])
	if row["variant_count"] != 1.0 || row["qty_available"] != "7.000" || row["warehouse_code"] != "STALL-01" {
		t.Fatalf("row %v", row)
	}
	e.jsonEq(row["variants"], `[{"sku_id":"`+e.org.HoldingID+`","sku":"KAOS-M","name":"Kaos M","options":{"size":"M"},"stock_quantity":3}]`)
	out = e.Call("GET", "/api/inventory/finished-goods?search=Kaos%20Merch&status=out_of_stock", nil, http.StatusOK)
	if len(e.list(out, "data")) != 0 || out["message"] != "Finished goods stock retrieved" {
		t.Fatalf("out of stock %v", out)
	}
}

func TestScrap(t *testing.T) {
	e := setup(t)
	rm := e.RawMaterial(e.org, "RMX-"+e.org.BranchID[:4], "Daging Scrap", e.unitKg, "", 1)
	e.Stock(e.org, rm, e.org.Stall1ID, 0, 0)
	batchNo, exp := "LOT-9", "2026-10-02"
	if err := ledger.AddFromGrn(e.Ctx, e.Tx, ledger.GrnReceipt{RawMaterialID: rm, Qty: 10, UnitCost: 5000, GrnID: e.org.MainID,
		GrnNumber: "GRN-S", UserID: e.Staff.UserID, WarehouseID: &e.org.Stall1ID, BatchNumber: &batchNo, ExpiryDate: &exp}, fixedNow); err != nil {
		t.Fatal(err)
	}
	var batchID string
	e.Scalar(&batchID, `SELECT id::text FROM inventory.stock_batches WHERE raw_material_id = $1`, rm)

	note := "jurnal posted"
	e.journals.note = &note
	out := e.Call("POST", "/api/inventory/scrap", map[string]any{"raw_material_id": rm, "warehouse_id": e.org.Stall1ID, "qty": 2.5,
		"reason": "expired", "notes": " busuk ", "batch_id": batchID}, http.StatusCreated)
	data := obj(out["data"])
	ref := data["reference_number"].(string)
	if !strings.HasPrefix(ref, "SCR-20261004030000-") || len(ref) != 23 {
		t.Fatalf("reference %q", ref)
	}
	if out["message"] != "Scrap "+ref+" tercatat, stok berkurang 2.5 (jurnal posted)" || data["qty_before"] != 10.0 ||
		data["qty_after"] != 7.5 || data["value"] != 12500.0 || data["accounting_note"] != "jurnal posted" {
		t.Fatalf("scrap %v", out)
	}
	j := e.journals.adjustments[0]
	if j.QtyDiff != -2.5 || j.UnitCost != 5000 || *j.Notes != "Scrap "+ref+" (Kedaluwarsa): busuk" || j.EntryDate != "2026-10-04" || *j.CompanyID != e.org.CompanyID {
		t.Fatalf("journal %+v", j)
	}
	if rem := e.num(`SELECT qty_remaining FROM inventory.stock_batches WHERE id = $1`, batchID); rem != 7.5 {
		t.Fatalf("batch remaining %v", rem)
	}
	var auditReason string
	e.Scalar(&auditReason, `SELECT reason FROM audit.audit_log WHERE entity_label = $1 AND action = 'stock.scrap'`, ref)
	if auditReason != "Kedaluwarsa: busuk" {
		t.Fatal(auditReason)
	}

	e.Fail("POST", "/api/inventory/scrap", map[string]any{"raw_material_id": rm, "warehouse_id": e.org.Stall1ID, "qty": 100, "reason": "damaged"},
		http.StatusConflict, "Stok gudang tidak cukup (tersedia 7.5)")
	e.Fail("POST", "/api/inventory/scrap", map[string]any{"raw_material_id": rm, "warehouse_id": e.org.MainID, "qty": 1, "reason": "damaged"},
		http.StatusNotFound, "Bahan baku tidak punya stok di gudang ini")
	out = e.Fail("POST", "/api/inventory/scrap", map[string]any{"raw_material_id": rm, "warehouse_id": e.org.Stall1ID, "qty": 0, "reason": "x"},
		http.StatusBadRequest, "Validation failed")
	e.jsonEq(out["details"], `[{"code":"too_small","path":["qty"],"message":"Qty scrap harus lebih dari 0"},
		{"code":"invalid_value","path":["reason"],"message":"Invalid option: expected one of \"expired\"|\"damaged\"|\"spoiled\"|\"sample\"|\"other\""}]`)

	out = e.Call("GET", "/api/inventory/scrap?limit=0", nil, http.StatusOK)
	e.jsonEq(out["meta"], `{"page":1,"limit":50,"total":1}`)
	if obj(e.list(out, "data")[0])["batch_numbers"] != "LOT-9" {
		t.Fatalf("history %v", out["data"])
	}
}

func TestStockOpnameLifecycle(t *testing.T) {
	e := setup(t)
	e.ScopeStaff("branch", e.org)
	rmA := e.RawMaterial(e.org, "RMO-A"+e.org.BranchID[:3], "A Opname", e.unitKg, "", 1)
	rmB := e.RawMaterial(e.org, "RMO-B"+e.org.BranchID[:3], "B Opname", e.unitKg, "", 1)
	e.Stock(e.org, rmA, e.org.Stall1ID, 10, 1000)

	out := e.Call("GET", "/api/inventory/stock-opnames/preview?warehouse_id="+e.org.Stall1ID, nil, http.StatusOK)
	if out["total"] != 2.0 {
		t.Fatalf("preview %v", out)
	}
	e.jsonEq(e.list(out, "data")[1], `{"inventory_id":null,"raw_material_id":"`+rmB+`","material_kode":"RMO-B`+e.org.BranchID[:3]+`",
		"material_nama":"B Opname","satuan":"Kilogram","satuan_besar_nama":"Kilogram","satuan_kecil_nama":null,"konversi_factor":1,
		"qty_system":0,"unit_cost":1000}`)

	out = e.Call("POST", "/api/inventory/stock-opnames", map[string]any{"warehouse_id": e.org.Stall1ID, "notes": "bulanan"}, http.StatusOK)
	if out["message"] != "Sesi stock opname berhasil dibuat" {
		t.Fatal(out["message"])
	}
	d := obj(out["data"])
	id := d["id"].(string)
	if d["status"] != "draft" || d["total_lines"] != 2.0 || d["opname_date"] != "2026-10-04T00:00:00.000Z" || d["branch_id"] != e.org.BranchID ||
		!strings.HasPrefix(d["opname_number"].(string), "OPN-") {
		t.Fatalf("created %v", d)
	}
	e.jsonEq(d["warehouse"], `{"id":"`+e.org.Stall1ID+`","name":"Stall 1","code":"STALL-01"}`)
	lines := e.list(d, "lines")
	lineA, lineB := obj(lines[0])["id"].(string), obj(lines[1])["id"].(string)

	e.Fail("POST", "/api/inventory/stock-opnames/"+id+"/complete", nil, http.StatusBadRequest, "Masih ada 2 baris yang belum dihitung")
	out = e.Call("PATCH", "/api/inventory/stock-opnames/"+id, map[string]any{"lines": []any{
		map[string]any{"id": lineA, "qty_counted": 8}, map[string]any{"id": lineB, "qty_counted": 3, "notes": "temuan"}}}, http.StatusOK)
	d = obj(out["data"])
	if out["message"] != "Perubahan stock opname disimpan" || d["status"] != "in_progress" || d["lines_counted"] != 2.0 || d["lines_with_variance"] != 2.0 {
		t.Fatalf("patched %v", out)
	}
	if obj(e.list(d, "lines")[0])["qty_variance"] != -2.0 {
		t.Fatalf("variance %v", d["lines"])
	}

	out = e.Call("POST", "/api/inventory/stock-opnames/"+id+"/complete", nil, http.StatusOK)
	if out["message"] != "Stock opname selesai dan stok telah disesuaikan" || out["accounting_note"] != nil || obj(out["data"])["status"] != "completed" {
		t.Fatalf("complete %v", out)
	}
	if q := e.num(`SELECT qty_available FROM inventory.inventory WHERE raw_material_id = $1 AND warehouse_id = $2`, rmA, e.org.Stall1ID); q != 8 {
		t.Fatalf("A qty %v", q)
	}
	var alasan string
	e.Scalar(&alasan, `SELECT alasan FROM inventory.inventory_movements WHERE raw_material_id = $1 AND reference_type = 'stock_opname'`, rmB)
	if alasan != "temuan" {
		t.Fatal(alasan)
	}
	if len(e.journals.opnames) != 1 || e.journals.opnames[0].OpnameDate != "2026-10-04" || len(e.journals.opnames[0].Lines) != 2 {
		t.Fatalf("journal %+v", e.journals.opnames)
	}
	e.Fail("PATCH", "/api/inventory/stock-opnames/"+id, map[string]any{"status": "cancelled"}, http.StatusBadRequest, "Stock opname yang sudah selesai tidak dapat diubah")

	out = e.Call("GET", "/api/inventory/stock-opnames?status=completed", nil, http.StatusOK)
	e.jsonEq(out["pagination"], `{"page":1,"limit":20,"total":1,"total_pages":1}`)
	e.jsonEq(obj(e.list(out, "data")[0])["lines"], `[]`)
	out = e.Fail("GET", "/api/inventory/stock-opnames?warehouse_id=", nil, http.StatusBadRequest, "Validasi gagal")
	e.jsonEq(out["details"], `{"warehouse_id":["Invalid UUID"]}`)

	other := e.NewOrg()
	e.ScopeStaff("branch", other)
	e.Fail("GET", "/api/inventory/stock-opnames/"+id, nil, http.StatusNotFound, "Stock opname tidak ditemukan")
	e.Fail("POST", "/api/inventory/stock-opnames", map[string]any{"warehouse_id": e.org.Stall1ID}, http.StatusBadRequest, "Gudang tidak valid atau tidak diizinkan")
}

func TestProductOpnameWithVariants(t *testing.T) {
	e := setup(t)
	plain := e.Product(e.org, e.org.Stall2ID, "PRD-P"+e.org.BranchID[:3], "Air Mineral", 3000)
	merch := e.Product(e.org, e.org.Stall2ID, "PRD-M"+e.org.BranchID[:3], "Topi", 50000)
	posProduct := e.ID(`INSERT INTO pos.pos_products (sku, name, product_kind, source_product_id) VALUES ('TOPI-'||$2, 'Topi', 'merchandise', $1)
		RETURNING id::text`, merch, e.org.BranchID[:6])
	skuS := e.ID(`INSERT INTO pos.pos_product_skus (product_id, sku, name, stock_quantity) VALUES ($1, 'TOPI-S', 'Topi S', 5) RETURNING id::text`, posProduct)
	skuL := e.ID(`INSERT INTO pos.pos_product_skus (product_id, sku, name, stock_quantity) VALUES ($1, 'TOPI-L', 'Topi L', 2) RETURNING id::text`, posProduct)
	e.skus.byProduct[merch] = []stock.Sku{{ID: skuL, Sku: "TOPI-L", Name: "Topi L", StockQuantity: 2}, {ID: skuS, Sku: "TOPI-S", Name: "Topi S", StockQuantity: 5}}
	e.skus.qty[skuL], e.skus.qty[skuS] = 2, 5

	out := e.Call("GET", "/api/inventory/product-stock-opnames/preview?warehouse_id="+e.org.Stall2ID, nil, http.StatusOK)
	if out["total"] != 3.0 {
		t.Fatalf("preview %v", out)
	}
	e.jsonEq(e.list(out, "data")[1], `{"inventory_id":null,"product_id":"`+merch+`","product_kode":"PRD-M`+e.org.BranchID[:3]+`","product_nama":"Topi",
		"satuan":null,"qty_system":2,"unit_cost":50000,"pos_sku_id":"`+skuL+`","pos_sku_code":"TOPI-L","pos_sku_name":"Topi L"}`)

	out = e.Call("POST", "/api/inventory/product-stock-opnames", map[string]any{"warehouse_id": e.org.Stall2ID}, http.StatusOK)
	d := obj(out["data"])
	id := d["id"].(string)
	if d["company_id"] != e.org.CompanyID || obj(d["branch"])["code"] == "" || len(e.list(d, "lines")) != 3 {
		t.Fatalf("created %v", d)
	}
	var patch []any
	for _, l := range e.list(d, "lines") {
		line := obj(l)
		counted := map[string]float64{"TOPI-L": 4, "TOPI-S": 5}[str(line["pos_sku_code"])]
		if line["product_id"] == plain {
			counted = 9
		}
		patch = append(patch, map[string]any{"id": line["id"], "qty_counted": counted})
	}
	e.Call("PATCH", "/api/inventory/product-stock-opnames/"+id, map[string]any{"lines": patch}, http.StatusOK)

	e.skus.qty[skuL] = 1 // live stock moved since the count: before = 1, delta +3
	out = e.Call("POST", "/api/inventory/product-stock-opnames/"+id+"/complete", nil, http.StatusOK)
	if out["message"] != "Stock opname produk selesai dan stok telah disesuaikan" || obj(out["data"])["status"] != "completed" {
		t.Fatalf("complete %v", out)
	}
	if e.skus.qty[skuL] != 4 || e.skus.qty[skuS] != 5 {
		t.Fatalf("sku stock %v", e.skus.qty)
	}
	if q := e.num(`SELECT qty_available FROM inventory.finished_goods_inventory WHERE product_id = $1`, merch); q != 3 {
		t.Fatalf("merch product qty %v", q)
	}
	if q := e.num(`SELECT qty_available FROM inventory.finished_goods_inventory WHERE product_id = $1`, plain); q != 9 {
		t.Fatalf("plain qty %v", q)
	}
	if n := e.num(`SELECT count(*) FROM inventory.finished_goods_movements WHERE reference_id = $1`, id); n != 3 {
		t.Fatalf("movements %v", n)
	}
	e.Fail("POST", "/api/inventory/product-stock-opnames/"+id+"/complete", nil, http.StatusBadRequest, "Stock opname sudah diselesaikan sebelumnya")
	e.ScopeStaff("company", e.NewOrg())
	e.Fail("GET", "/api/inventory/product-stock-opnames/"+id, nil, http.StatusNotFound, "Stock opname produk tidak ditemukan")
}

func str(v any) string {
	s, _ := v.(string)
	return s
}
