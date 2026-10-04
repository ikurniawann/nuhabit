package stock_test

import (
	"context"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	contracts "nuhabit/backend/internal/contracts/inventory"
	"nuhabit/backend/internal/contracts/procurement"
	"nuhabit/backend/internal/modules/inventory/stock"
	"nuhabit/backend/internal/platform/outbox"
)

func TestPurchasingStockReads(t *testing.T) {
	e := setup(t)
	e.ScopeStaff("branch", e.org)
	rm := e.RawMaterial(e.org, "RMP-"+e.org.BranchID[:4], "Garam Purch", e.unitKg, "", 1)
	e.Stock(e.org, rm, e.org.MainID, 0, 700)

	out := e.Call("GET", "/api/purchasing/inventory?below_minimum=true&search=Garam%20Purch", nil, http.StatusOK)
	rows := e.list(out, "data")
	if len(rows) != 1 || obj(rows[0])["status_stok"] != "HABIS" || obj(rows[0])["qty_onhand"] != "0.000" {
		t.Fatalf("stock %v", rows)
	}
	out = e.Call("GET", "/api/purchasing/inventory/"+rm, nil, http.StatusOK)
	if obj(out["data"])["kode"] != "RMP-"+e.org.BranchID[:4] {
		t.Fatalf("detail %v", out)
	}
	e.Fail("GET", "/api/purchasing/inventory/"+e.org.MainID, nil, http.StatusNotFound, "Inventory tidak ditemukan")

	// An admin without stall access stays on "Semua Stall" whatever the cookie.
	e.ActiveStall(e.org.Stall1ID)
	out = e.Call("GET", "/api/purchasing/inventory?search=Garam%20Purch", nil, http.StatusOK)
	if _, perWarehouse := obj(e.list(out, "data")[0])["warehouse_id"]; perWarehouse {
		t.Fatalf("aggregate view expected: %v", out["data"])
	}
	// With switch rights the cookie selects the per-warehouse view.
	e.Exec(`UPDATE configuration.users SET can_switch_stall = true WHERE id = $1`, e.Staff.UserID)
	out = e.Call("GET", "/api/purchasing/inventory?search=Garam%20Purch", nil, http.StatusOK)
	if len(e.list(out, "data")) != 0 {
		t.Fatalf("stall 1 has no row for the material: %v", out["data"])
	}
	e.Cookies = nil

	e.Call("POST", "/api/purchasing/inventory/adjustment", map[string]any{"raw_material_id": rm, "warehouse_id": e.org.MainID, "qty_actual": 5}, http.StatusOK)
	out = e.Call("GET", "/api/purchasing/inventory/"+rm+"/movements?limit=1", nil, http.StatusOK)
	mv := obj(e.list(out, "data")[0])
	if mv["reference_type"] != "adjustment" || obj(mv["raw_material"])["nama"] != "Garam Purch" || obj(mv["raw_material"])["konversi_factor"] != 1.0 {
		t.Fatalf("material movements %v", mv)
	}
	if rec := e.Do("GET", "/api/purchasing/inventory/"+rm+"/other", nil); rec.Code != http.StatusNotFound {
		t.Fatalf("unknown sub-route: %d", rec.Code)
	}

	// The movement card lists the branch's movements with their embeds.
	out = e.Call("GET", "/api/purchasing/inventory/movements?bahan_id="+rm, nil, http.StatusOK)
	list := e.list(out, "data")
	if len(list) != 1 || obj(out["pagination"])["total"] != 1.0 || obj(out["pagination"])["totalPages"] != 1.0 {
		t.Fatalf("movements %v", out)
	}
	mv = obj(list[0])
	if mv["reference_type"] != "adjustment" || mv["jumlah"] != "5.000" || obj(mv["inventory"])["id"] != mv["inventory_id"] ||
		obj(mv["raw_material"])["nama"] != "Garam Purch" || obj(mv["creator"])["full_name"] != e.Staff.FullName {
		t.Fatalf("movement %v", mv)
	}
	out = e.Call("GET", "/api/purchasing/inventory/movements?tipe=out&bahan_id="+rm, nil, http.StatusOK)
	if len(e.list(out, "data")) != 0 {
		t.Fatalf("tipe filter %v", out)
	}
	out = e.Fail("GET", "/api/purchasing/inventory/movements?page=0", nil, http.StatusBadRequest, "Too small: expected number to be >=1")
	if len(e.list(out, "details")) != 1 {
		t.Fatalf("details %v", out["details"])
	}
}

func TestPurchasingAdjustment(t *testing.T) {
	e := setup(t)
	rm := e.RawMaterial(e.org, "RMA-"+e.org.BranchID[:4], "Minyak Adj", e.unitKg, "", 1)
	e.Stock(e.org, rm, e.org.Stall1ID, 10, 1200)

	out := e.Call("POST", "/api/purchasing/inventory/adjustment", map[string]any{"raw_material_id": rm, "warehouse_id": e.org.Stall1ID,
		"qty_actual": 10}, http.StatusOK)
	if out["message"] != "Stok berhasil disesuaikan" {
		t.Fatal(out)
	}
	if _, has := out["accounting_note"]; has {
		t.Fatalf("no-change response has no accounting_note: %v", out)
	}
	e.jsonEq(out["adjustment"], `{"qty_before":10,"qty_after":10,"qty_diff":0}`)

	note := "jurnal draft: mapping belum lengkap"
	e.journals.note = &note
	out = e.Call("POST", "/api/purchasing/inventory/adjustment", map[string]any{"raw_material_id": rm, "warehouse_id": e.org.Stall1ID,
		"qty_actual": 7.5, "notes": "rusak"}, http.StatusOK)
	if out["message"] != "Stok berhasil disesuaikan (jurnal draft: mapping belum lengkap)" || out["accounting_note"] != note ||
		obj(out["data"])["qty_available"] != "7.500" {
		t.Fatalf("adjust %v", out)
	}
	var alasan string
	e.Scalar(&alasan, `SELECT alasan FROM inventory.inventory_movements WHERE raw_material_id = $1 AND reference_type = 'adjustment'`, rm)
	if alasan != "rusak" || e.journals.adjustments[0].QtyDiff != -2.5 || *e.journals.adjustments[0].CompanyID != e.org.CompanyID {
		t.Fatalf("movement %q journal %+v", alasan, e.journals.adjustments)
	}
	if n := e.num(`SELECT count(*) FROM audit.audit_log WHERE action = 'stock.adjust' AND entity_label = $1`, "RMA-"+e.org.BranchID[:4]); n != 1 {
		t.Fatalf("audit %v", n)
	}

	// A material of another branch is forbidden for a branch user.
	other := e.NewOrg()
	foreign := e.RawMaterial(other, "RMF-"+other.BranchID[:4], "Asing", e.unitKg, "", 1)
	e.ScopeStaff("branch", e.org)
	e.Fail("POST", "/api/purchasing/inventory/adjustment", map[string]any{"raw_material_id": foreign, "warehouse_id": e.org.Stall1ID, "qty_actual": 1},
		http.StatusForbidden, "Bahan baku tidak tersedia untuk cabang Anda")
	e.Fail("POST", "/api/purchasing/inventory/adjustment", map[string]any{"raw_material_id": rm, "warehouse_id": other.Stall1ID, "qty_actual": 1},
		http.StatusBadRequest, "Gudang tidak valid atau tidak diizinkan")
	e.Fail("POST", "/api/purchasing/inventory/adjustment", map[string]any{"raw_material_id": "x", "warehouse_id": e.org.Stall1ID, "qty_actual": 1},
		http.StatusBadRequest, "Bahan baku wajib dipilih")
}

func TestTransfers(t *testing.T) {
	e := setup(t)
	rm := e.RawMaterial(e.org, "RMT-"+e.org.BranchID[:4], "Beras Transfer", e.unitKg, "", 1)
	e.Stock(e.org, rm, e.org.MainID, 20, 1000)
	e.Stock(e.org, rm, e.org.Stall1ID, 10, 1600)

	body := map[string]any{"transfer_kind": "main_to_stall", "source_warehouse_id": e.org.MainID, "dest_warehouse_id": e.org.Stall1ID,
		"raw_material_id": rm, "qty": 5, "notes": " pagi "}
	out := e.Call("POST", "/api/purchasing/inventory/transfer", body, http.StatusOK)
	data := obj(out["data"])
	number := data["transfer_number"].(string)
	if number != "TRF-20261004-0001" || out["message"] != "Stock transferred successfully (TRF-20261004-0001)" || data["unit_cost"] != 1000.0 {
		t.Fatalf("transfer %v", out)
	}
	e.jsonEq(data["source_warehouse"], `{"id":"`+e.org.MainID+`","code":"MAIN","name":"Main Storage","branch_id":"`+e.org.BranchID+`","is_default":true}`)
	// 10 @ 1600 + 5 @ 1000 → 1400 average at the stall.
	if c := e.num(`SELECT unit_cost FROM inventory.inventory WHERE raw_material_id = $1 AND warehouse_id = $2`, rm, e.org.Stall1ID); c != 1400 {
		t.Fatalf("dest cost %v", c)
	}
	if e.journals.transfers[0].SourceWarehouseName != "Main Storage" || e.journals.transfers[0].Qty != 5 {
		t.Fatalf("journal %+v", e.journals.transfers)
	}

	body["qty"] = 100
	e.Fail("POST", "/api/purchasing/inventory/transfer", body, http.StatusBadRequest, "Insufficient stock. Available: 15")
	body["qty"], body["transfer_kind"] = 1, "stall_to_main"
	e.Fail("POST", "/api/purchasing/inventory/transfer", body, http.StatusBadRequest, "Source must be a stall")
	body["qty"] = 0
	e.Fail("POST", "/api/purchasing/inventory/transfer", body, http.StatusBadRequest, "Quantity must be greater than zero")

	out = e.Call("GET", "/api/purchasing/inventory/transfer?limit=10", nil, http.StatusOK)
	e.jsonEq(out["pagination"], `{"page":1,"limit":10,"total":1,"total_pages":1}`)
	row := obj(e.list(out, "data")[0])
	if row["transfer_kind"] != "main_to_stall" || row["notes"] != "pagi" || row["qty"] != 5.0 || row["dest_warehouse_code"] != "STALL-01" {
		t.Fatalf("list %v", row)
	}
	e.Fail("GET", "/api/purchasing/inventory/transfer?page=", nil, http.StatusBadRequest, "Too small: expected number to be >=1")

	out = e.Call("GET", "/api/purchasing/inventory/transfer/preview?warehouse_id="+e.org.MainID, nil, http.StatusOK)
	if out["total"] != 1.0 || obj(e.list(out, "data")[0])["qty_system"] != 15.0 {
		t.Fatalf("preview %v", out)
	}
	e.Fail("GET", "/api/purchasing/inventory/transfer/preview", nil, http.StatusBadRequest, "Invalid input: expected string, received undefined")
}

func TestSupplyStock(t *testing.T) {
	e := setup(t)
	e.ScopeStaff("branch", e.org)
	item := e.ID(`INSERT INTO item.supply_items (kode, nama, stockable, satuan_id, company_id, branch_id, stok_minimum)
		VALUES ('SUP-'||$1, 'Tisu', true, $2, $3, $4, 10) RETURNING id::text`, e.org.BranchID[:4], e.unitKg, e.org.CompanyID, e.org.BranchID)

	out := e.Call("POST", "/api/purchasing/inventory/supply-adjustment", map[string]any{"supply_item_id": item, "warehouse_id": e.org.MainID,
		"qty_actual": 12}, http.StatusOK)
	e.jsonEq(out, `{"success":true,"data":{"qtyBefore":0,"qtyAfter":12,"qtyDiff":12},"message":"Stok berhasil disesuaikan"}`)

	e.Fail("POST", "/api/purchasing/inventory/supply-usage", map[string]any{"warehouse_id": e.org.MainID, "items": []any{
		map[string]any{"supply_item_id": item, "qty": 50}}}, http.StatusBadRequest, "Stok tidak cukup untuk salah satu barang (tersedia 12, diminta 50)")
	e.Fail("POST", "/api/purchasing/inventory/supply-usage", map[string]any{"warehouse_id": e.org.MainID, "items": []any{}},
		http.StatusBadRequest, "Minimal satu barang")
	out = e.Call("POST", "/api/purchasing/inventory/supply-usage", map[string]any{"warehouse_id": e.org.MainID, "keperluan": "Dapur",
		"items": []any{map[string]any{"supply_item_id": item, "qty": 4}}}, http.StatusOK)
	nomor := obj(out["data"])["nomor"].(string)
	if !strings.HasPrefix(nomor, "PMK-20261004-") || out["message"] != "Pemakaian "+nomor+" tercatat" {
		t.Fatalf("usage %v", out)
	}

	out = e.Call("GET", "/api/purchasing/inventory/supply?low_stock=1", nil, http.StatusOK)
	rows := e.list(out, "data")
	if len(rows) != 1 || obj(rows[0])["qty_available"] != "8.000" || obj(rows[0])["qty_minimum"] != "10" {
		t.Fatalf("supply %v", rows)
	}
	id := obj(rows[0])["id"].(string)
	out = e.Call("GET", "/api/purchasing/inventory/supply/"+id, nil, http.StatusOK)
	d := obj(out["data"])
	// Both movements share the transaction's now(); order within it is by id.
	if d["stockable"] != true || len(e.list(d, "movements")) != 2 || d["qty_available"] != "8.000" {
		t.Fatalf("detail %v", d)
	}
	out = e.Call("GET", "/api/purchasing/inventory/supply-usage", nil, http.StatusOK)
	if obj(e.list(out, "data")[0])["keperluan"] != "Dapur" {
		t.Fatalf("usages %v", out)
	}
	out = e.Call("GET", "/api/purchasing/inventory/supply/form-data", nil, http.StatusOK)
	fd := obj(out["data"])
	if len(e.list(fd, "warehouses")) != 3 || len(e.list(fd, "supplies")) != 1 {
		t.Fatalf("form data %v", fd)
	}

	e.ScopeStaff("branch", e.NewOrg())
	e.Fail("GET", "/api/purchasing/inventory/supply/"+id, nil, http.StatusNotFound, "Stok tidak ditemukan")
}

func TestProcurementSubscribers(t *testing.T) {
	e := setup(t)
	rm := e.RawMaterial(e.org, "RMG-"+e.org.BranchID[:4], "Kecap GRN", e.unitKg, e.unitGr, 1000)
	supply := e.ID(`INSERT INTO item.supply_items (kode, nama, stockable) VALUES ('SUPG-'||$1, 'Sabun', true) RETURNING id::text`, e.org.BranchID[:4])
	bus := outbox.NewBus(nil, e.Deps.Log)
	stock.Subscribe(bus, func() time.Time { return fixedNow })
	ctx := context.Background()
	if err := bus.Register(ctx, e.Tx); err != nil {
		t.Fatal(err)
	}
	publish := func(topic string, payload any) {
		t.Helper()
		if err := outbox.Publish(ctx, e.Tx, topic, "k", payload); err != nil {
			t.Fatal(err)
		}
		if _, err := bus.Dispatch(ctx, e.Tx); err != nil {
			t.Fatal(err)
		}
	}

	// A PO sent in kilograms puts 2 kg = 2000 g on order.
	publish(procurement.TopicPurchaseOrderOnOrderChanged, procurement.PurchaseOrderOnOrderChanged{
		PurchaseOrderID: e.org.MainID, Direction: 1, Lines: []procurement.OnOrderLine{{RawMaterialID: rm, SatuanID: &e.unitKg, OpenQty: 2}}})
	if q := e.num(`SELECT qty_on_order FROM inventory.inventory WHERE raw_material_id = $1`, rm); q != 2000 {
		t.Fatalf("on order %v", q)
	}

	exp, batch := "2026-12-01", "K-1"
	publish(procurement.TopicGrnStockReceived, procurement.GrnStockReceived{GrnID: e.org.Stall1ID, GrnNumber: "GRN-K", UserID: e.Staff.UserID,
		Lines: []procurement.GrnStockLine{
			{RawMaterialID: &rm, Qty: 1500, UnitCost: 12.5, WarehouseID: &e.org.MainID, BatchNumber: &batch, ExpiryDate: &exp},
			{SupplyItemID: &supply, Qty: 3, UnitCost: 2000, WarehouseID: &e.org.MainID},
		}})
	var qty, onOrder float64
	e.Scalar(&qty, `SELECT sum(qty_available) FROM inventory.inventory WHERE raw_material_id = $1`, rm)
	e.Scalar(&onOrder, `SELECT sum(qty_on_order) FROM inventory.inventory WHERE raw_material_id = $1`, rm)
	if qty != 1500 {
		t.Fatalf("received %v (on order %v)", qty, onOrder)
	}
	// Master price per satuan besar (kg = 1000 g): 12.5 × 1000.
	if h := e.num(`SELECT harga_beli FROM item.raw_materials WHERE id = $1`, rm); h != 12500 {
		t.Fatalf("harga_beli %v", h)
	}
	if b := e.num(`SELECT count(*) FROM inventory.stock_batches WHERE raw_material_id = $1 AND batch_number = 'K-1' AND expiry_date = '2026-12-01'`, rm); b != 1 {
		t.Fatalf("batch %v", b)
	}
	if s := e.num(`SELECT qty_available FROM inventory.supply_inventory WHERE supply_item_id = $1`, supply); s != 3 {
		t.Fatalf("supply %v", s)
	}
	var branch string
	e.Scalar(&branch, `SELECT branch_id::text FROM inventory.supply_inventory WHERE supply_item_id = $1`, supply)
	if branch != e.org.BranchID {
		t.Fatalf("supply branch %q", branch)
	}
}

func TestOutboxJournalsPublish(t *testing.T) {
	e := setup(t)
	var got contracts.StockAdjusted
	bus := outbox.NewBus(nil, e.Deps.Log)
	bus.Subscribe(contracts.TopicStockAdjusted, "test.inventory-adjusted", func(_ context.Context, _ pgx.Tx, ev outbox.Event) error {
		return ev.Decode(&got)
	})
	ctx := context.Background()
	if err := bus.Register(ctx, e.Tx); err != nil {
		t.Fatal(err)
	}
	note, err := stock.OutboxJournals{}.PostStockAdjustment(ctx, e.Tx, stock.AdjustmentJournal{DocumentID: "d1", UserID: "u", EntryDate: "2026-10-04",
		RawMaterialID: "rm", QtyDiff: -2, UnitCost: 10})
	if err != nil || note != nil {
		t.Fatalf("%v %v", note, err)
	}
	if _, err := bus.Dispatch(ctx, e.Tx); err != nil {
		t.Fatal(err)
	}
	if got.DocumentID != "d1" || got.QtyDiff != -2 {
		t.Fatalf("event %+v", got)
	}
}
