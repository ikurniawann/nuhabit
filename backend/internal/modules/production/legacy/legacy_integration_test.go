package legacy_test

import (
	"context"
	"net/http"
	"testing"
	"time"

	"nuhabit/backend/internal/app"
	"nuhabit/backend/internal/modules/inventory/kit"
	"nuhabit/backend/internal/modules/inventory/kit/kittest"
	"nuhabit/backend/internal/modules/production/legacy"
	"nuhabit/backend/internal/platform/database"
)

// Integration tests on TEST_DATABASE_URL in one rolled-back transaction.
// Item masters and stock run through the real adapters of internal/app;
// the POS port is a fake. Response shapes and database effects were also
// diffed against the TS routes on seeded data (product, raw material, WIP
// and variant orders).

type fakePos struct {
	posProduct string
	skus       []legacy.Sku
	stock      map[string]float64
	synced     int
}

func (f *fakePos) MerchandiseSkus(context.Context, database.Querier, string) (string, []legacy.Sku, error) {
	return f.posProduct, f.skus, nil
}

func (f *fakePos) AddSkuStock(_ context.Context, _ database.Querier, sku, _ string, qty float64) (float64, bool, error) {
	f.stock[sku] += qty
	return f.stock[sku], true, nil
}

func (f *fakePos) SkuLabels(context.Context, database.Querier, []string) (map[string]legacy.Sku, error) {
	out := map[string]legacy.Sku{}
	for _, s := range f.skus {
		out[s.ID] = s
	}
	return out, nil
}

func (f *fakePos) SyncHpp(context.Context, database.Querier, string, float64) (*kit.Row, error) {
	f.synced++
	return kit.Obj("mode", "updated", "margin_percentage", 40.5), nil
}

func obj(v any) map[string]any {
	m, _ := v.(map[string]any)
	return m
}

// mount serves the legacy routes with the real item and stock adapters.
func mount(e *kittest.T, pos *fakePos) {
	ports := app.LegacyProductionPorts(e.Env.Now)
	ports.Pos = pos
	e.Mount(legacy.Routes(e.Env, ports))
}

func TestProductOrderLifecycle(t *testing.T) {
	e := kittest.Setup(t, kittest.Menus, func() time.Time { return time.Date(2026, 10, 4, 3, 0, 0, 0, time.UTC) })
	org := e.NewOrg()
	e.ScopeStaff("branch", org)
	pos := &fakePos{stock: map[string]float64{}}
	mount(e, pos)
	kg := e.Unit("KG", "Kilogram")
	rm := e.RawMaterial(org, "RMP-"+org.BranchID[:4], "Beras", kg, "", 1)
	e.Stock(org, rm, org.MainID, 10, 12000)
	product := e.Product(org, org.Stall1ID, "PRP-"+org.BranchID[:4], "Nasi", 5000)
	e.Exec(`INSERT INTO manufacturing.bom_items (product_id, raw_material_id, qty_required, waste_factor) VALUES ($1, $2, 0.2, 0.1)`, product, rm)

	out := e.Call("POST", "/api/purchasing/production/orders", map[string]any{"product_id": product, "planned_qty": 5, "overhead_cost": 1000}, http.StatusCreated)
	order := obj(out["data"])
	id := order["id"].(string)
	// 0.2 × 1.1 × 5 = 1.1 kg at 12000 → 13200; HPP (13200 + 1000) / 5.
	if order["status"] != "DRAFT" || order["planned_material_cost"] != "13200.00" || order["hpp_per_unit"] != "2840.00" ||
		obj(order["materials"].([]any)[0])["qty_planned"].(float64)-1.1 > 1e-9 {
		t.Fatalf("create %v", order)
	}
	e.Fail("POST", "/api/purchasing/production/orders", map[string]any{"production_context": "x"}, http.StatusBadRequest, "Validation failed")
	e.Fail("PATCH", "/api/purchasing/production/orders/"+id, map[string]any{"action": "start"}, http.StatusBadRequest, "Hanya produksi RELEASED yang bisa dimulai")

	out = e.Call("PATCH", "/api/purchasing/production/orders/"+id, map[string]any{"action": "recheck_stock"}, http.StatusOK)
	if obj(out["data"])["can_release"] != true || out["message"] != "Stok bahan sudah cukup. Production order bisa di-release." {
		t.Fatalf("recheck %v", out)
	}
	e.Call("PATCH", "/api/purchasing/production/orders/"+id, map[string]any{"action": "release"}, http.StatusOK)
	e.Call("PATCH", "/api/purchasing/production/orders/"+id, map[string]any{"action": "start"}, http.StatusOK)
	out = e.Call("PATCH", "/api/purchasing/production/orders/"+id, map[string]any{"action": "complete", "actual_qty": 4}, http.StatusOK)
	if out["message"] != "Produksi "+obj(obj(out["data"])["order"])["nomor_produksi"].(string)+
		" selesai. HPP aktual Rp3.550 tersinkron ke POS. Margin POS 40.5%." || pos.synced != 1 {
		t.Fatalf("complete %v", out)
	}
	var qty, fg float64
	e.Scalar(&qty, `SELECT qty_available FROM inventory.inventory WHERE raw_material_id = $1`, rm)
	e.Scalar(&fg, `SELECT qty_available FROM inventory.finished_goods_inventory WHERE product_id = $1`, product)
	if qty != 8.9 || fg != 4 {
		t.Fatalf("stock %v fg %v", qty, fg)
	}
	e.Fail("PATCH", "/api/purchasing/production/orders/"+id, map[string]any{"action": "complete"}, http.StatusBadRequest, "Produksi harus IN_PROGRESS sebelum completed")
	e.Fail("PATCH", "/api/purchasing/production/orders/"+id, map[string]any{"action": "cancel"}, http.StatusBadRequest, "Produksi completed tidak bisa dibatalkan")

	out = e.Call("GET", "/api/purchasing/production/orders/"+id, nil, http.StatusOK)
	d := obj(out["data"])
	line := obj(d["materials"].([]any)[0])
	if d["status"] != "COMPLETED" || len(d["batches"].([]any)) != 1 || obj(d["stock_summary"])["total_materials"] != 1.0 ||
		obj(line["raw_material"])["nama"] != "Beras" || obj(line["satuan"])["nama"] != "Kilogram" || d["output_satuan_nama"] != nil {
		t.Fatalf("detail %v", d)
	}
	out = e.Call("GET", "/api/purchasing/production/orders?search=Nasi", nil, http.StatusOK)
	if len(out["data"].([]any)) != 1 {
		t.Fatalf("list %v", out)
	}
	e.Fail("GET", "/api/purchasing/production/orders/"+org.MainID, nil, http.StatusNotFound, "Production order not found")

	out = e.Call("GET", "/api/purchasing/production/product-recipes", nil, http.StatusOK)
	if r := obj(out["data"].([]any)[0]); r["total_bahan_baku"] != 1.0 {
		t.Fatalf("recipes %v", r)
	}
}

func TestVariantSplit(t *testing.T) {
	e := kittest.Setup(t, kittest.Menus, nil)
	org := e.NewOrg()
	kg := e.Unit("KG", "Kilogram")
	rm := e.RawMaterial(org, "RMV-"+org.BranchID[:4], "Kain", kg, "", 1)
	e.Stock(org, rm, org.MainID, 10, 1000)
	product := e.Product(org, org.Stall1ID, "PRV-"+org.BranchID[:4], "Kaos", 5000)
	posProduct := e.ID(`INSERT INTO pos.pos_products (sku, name, product_kind, source_product_id) VALUES ('KV-'||$2, 'Kaos', 'merchandise', $1)
		RETURNING id::text`, product, org.BranchID[:6])
	skuM := e.ID(`INSERT INTO pos.pos_product_skus (product_id, sku, name) VALUES ($1, 'KV-M', 'M') RETURNING id::text`, posProduct)
	skuL := e.ID(`INSERT INTO pos.pos_product_skus (product_id, sku, name) VALUES ($1, 'KV-L', 'L') RETURNING id::text`, posProduct)
	pos := &fakePos{posProduct: posProduct, skus: []legacy.Sku{{ID: skuM, Sku: "M", Name: "M"}, {ID: skuL, Sku: "L", Name: "L"}},
		stock: map[string]float64{}}
	mount(e, pos)
	e.Exec(`INSERT INTO manufacturing.bom_items (product_id, raw_material_id, qty_required) VALUES ($1, $2, 1)`, product, rm)
	out := e.Call("POST", "/api/purchasing/production/orders", map[string]any{"product_id": product, "planned_qty": 2}, http.StatusCreated)
	id := obj(out["data"])["id"].(string)
	e.Call("PATCH", "/api/purchasing/production/orders/"+id, map[string]any{"action": "release"}, http.StatusOK)
	e.Call("PATCH", "/api/purchasing/production/orders/"+id, map[string]any{"action": "start"}, http.StatusOK)
	e.Fail("PATCH", "/api/purchasing/production/orders/"+id, map[string]any{"action": "complete"}, http.StatusBadRequest, "Rincian varian wajib diisi")
	e.Fail("PATCH", "/api/purchasing/production/orders/"+id, map[string]any{"action": "complete", "variant_output": []any{
		map[string]any{"pos_sku_id": skuM, "qty": 1}}}, http.StatusBadRequest,
		"Rincian varian harus berjumlah sama dengan jumlah aktual (1 vs 2)")
	e.Call("PATCH", "/api/purchasing/production/orders/"+id, map[string]any{"action": "complete", "variant_output": []any{
		map[string]any{"pos_sku_id": skuM, "qty": 1.5}, map[string]any{"pos_sku_id": skuL, "qty": 0.5}}}, http.StatusOK)
	if pos.stock[skuM] != 1.5 || pos.stock[skuL] != 0.5 {
		t.Fatalf("sku stock %v", pos.stock)
	}
	var movements int
	e.Scalar(&movements, `SELECT count(*) FROM inventory.finished_goods_movements WHERE product_id = $1`, product)
	if movements != 3 {
		t.Fatalf("movements %d", movements)
	}
}

// A raw material order and a WIP order complete in one shot: the output
// comes into stock, the WIP order through the product's WIP material.
func TestRawMaterialAndWipOrders(t *testing.T) {
	e := kittest.Setup(t, kittest.Menus, nil)
	org := e.NewOrg()
	mount(e, &fakePos{stock: map[string]float64{}})
	kg := e.Unit("KG", "Kilogram")
	milk := e.RawMaterial(org, "RWM-"+org.BranchID[:4], "Susu", kg, "", 1)
	cream := e.RawMaterial(org, "RWC-"+org.BranchID[:4], "Krim", kg, "", 1)
	e.Stock(org, milk, org.MainID, 10, 20000)
	e.Exec(`INSERT INTO manufacturing.raw_material_bom_items (output_raw_material_id, component_raw_material_id, qty_required)
		VALUES ($1, $2, 2)`, cream, milk)
	out := e.Call("POST", "/api/purchasing/production/orders", map[string]any{"production_context": "raw_material",
		"raw_material_id": cream, "planned_qty": 1}, http.StatusCreated)
	id := obj(out["data"])["id"].(string)
	for _, action := range []string{"release", "start", "complete"} {
		e.Call("PATCH", "/api/purchasing/production/orders/"+id, map[string]any{"action": action}, http.StatusOK)
	}
	var qty, cost float64
	e.Scalar(&qty, `SELECT qty_available FROM inventory.inventory WHERE raw_material_id = $1`, cream)
	e.Scalar(&cost, `SELECT unit_cost FROM inventory.inventory WHERE raw_material_id = $1`, cream)
	if qty != 1 || cost != 40000 {
		t.Fatalf("cream %v @ %v", qty, cost)
	}

	product := e.Product(org, org.Stall1ID, "PRW-"+org.BranchID[:4], "Adonan", 5000)
	e.Exec(`INSERT INTO manufacturing.bom_items (product_id, raw_material_id, qty_required) VALUES ($1, $2, 1)`, product, milk)
	out = e.Call("POST", "/api/purchasing/production/orders", map[string]any{"product_id": product, "planned_qty": 2, "output_type": "WIP"},
		http.StatusCreated)
	id = obj(out["data"])["id"].(string)
	for _, action := range []string{"release", "start", "complete"} {
		e.Call("PATCH", "/api/purchasing/production/orders/"+id, map[string]any{"action": action}, http.StatusOK)
	}
	var wip string
	e.Scalar(&wip, `SELECT id::text FROM item.raw_materials WHERE source_product_id = $1 AND material_type = 'WIP'`, product)
	e.Scalar(&qty, `SELECT qty_available FROM inventory.inventory WHERE raw_material_id = $1`, wip)
	if qty != 2 {
		t.Fatalf("wip stock %v", qty)
	}
	list := e.Call("GET", "/api/purchasing/production/wip", nil, http.StatusOK)
	var found map[string]any
	for _, r := range list["data"].([]any) {
		if obj(r)["id"] == wip {
			found = obj(r)
		}
	}
	if found == nil || obj(found["source_product"])["nama"] != "Adonan" || obj(found["latest_batch"])["production_order_id"] != id {
		t.Fatalf("legacy wip %v", list)
	}
}

// A BOM line in the satuan besar becomes stock units (the satuan kecil) on
// the order: 0.25 kg of flour per loaf, stocked in grams at 20 per gram.
func TestOrderConvertsRecipeUnits(t *testing.T) {
	e := kittest.Setup(t, kittest.Menus, nil)
	org := e.NewOrg()
	mount(e, &fakePos{stock: map[string]float64{}})
	kg, gr := e.Unit("KG", "Kilogram"), e.Unit("GR", "Gram")
	flour := e.RawMaterial(org, "RMU-"+org.BranchID[:4], "Tepung", kg, gr, 1000)
	salt := e.RawMaterial(org, "RMN-"+org.BranchID[:4], "Garam", kg, gr, 1000)
	e.Stock(org, flour, org.MainID, 5000, 20)
	e.Stock(org, salt, org.MainID, 500, 10)
	product := e.Product(org, org.Stall1ID, "PRU-"+org.BranchID[:4], "Roti", 5000)
	e.Exec(`INSERT INTO manufacturing.bom_items (product_id, raw_material_id, qty_required, satuan_id) VALUES ($1, $2, 0.25, $3), ($1, $4, 5, $5)`,
		product, flour, kg, salt, gr)

	out := e.Call("POST", "/api/purchasing/production/orders", map[string]any{"product_id": product, "planned_qty": 4}, http.StatusCreated)
	order := obj(out["data"])
	lines := map[any]map[string]any{}
	for _, m := range order["materials"].([]any) {
		lines[obj(m)["raw_material_id"]] = obj(m)
	}
	f, s := lines[flour], lines[salt]
	// 1 kg = 1000 g at 20, 20 g of salt at 10: 20200.
	if f["qty_planned"] != 1000.0 || f["recipe_qty"] != 1.0 || f["unit_factor"] != 1000.0 || f["satuan_id"] != gr || f["recipe_satuan_id"] != kg ||
		s["qty_planned"] != 20.0 || s["unit_factor"] != 1.0 || order["planned_material_cost"] != "20200.00" {
		t.Fatalf("converted order %v", order)
	}
	d := obj(e.Call("GET", "/api/purchasing/production/orders/"+order["id"].(string), nil, http.StatusOK)["data"])
	for _, m := range d["materials"].([]any) {
		line := obj(m)
		if line["raw_material_id"] == flour && (line["qty_planned"] != "1000.0000" || obj(line["satuan"])["nama"] != "Gram" ||
			obj(line["recipe_satuan"])["nama"] != "Kilogram" || line["unit_factor"] != "1000.000000") {
			t.Fatalf("detail line %v", line)
		}
	}
	if obj(d["stock_summary"])["can_release"] != true {
		t.Fatalf("5000 g covers 1000 g: %v", d["stock_summary"])
	}
}

// An order the production module issued materials for no longer completes
// or cancels in one shot.
func TestSteppedOrderRefusesOneShot(t *testing.T) {
	e := kittest.Setup(t, kittest.Menus, nil)
	org := e.NewOrg()
	mount(e, &fakePos{stock: map[string]float64{}})
	kg := e.Unit("KG", "Kilogram")
	rm := e.RawMaterial(org, "RMS-"+org.BranchID[:4], "Beras", kg, "", 1)
	e.Stock(org, rm, org.MainID, 10, 12000)
	product := e.Product(org, org.Stall1ID, "PRS-"+org.BranchID[:4], "Nasi", 5000)
	e.Exec(`INSERT INTO manufacturing.bom_items (product_id, raw_material_id, qty_required) VALUES ($1, $2, 1)`, product, rm)
	out := e.Call("POST", "/api/purchasing/production/orders", map[string]any{"product_id": product, "planned_qty": 2}, http.StatusCreated)
	id := obj(out["data"])["id"].(string)
	e.Exec(`UPDATE manufacturing.production_orders SET status = 'IN_PROGRESS' WHERE id = $1`, id)
	e.Exec(`INSERT INTO manufacturing.production_issues (production_order_id, nomor_issue) VALUES ($1::uuid, 'ISS-'||$1::text)`, id)
	msg := "Bahan order ini sudah dikeluarkan bertahap. Selesaikan lewat Terima Hasil di Langkah Produksi."
	e.Fail("PATCH", "/api/purchasing/production/orders/"+id, map[string]any{"action": "complete"}, http.StatusBadRequest, msg)
	e.Fail("PATCH", "/api/purchasing/production/orders/"+id, map[string]any{"action": "cancel"}, http.StatusBadRequest, msg)
}

// Product and raw material BOM lines: add, cost per small unit, update,
// remove. Moved here from the inventory catalog.
func TestBomLines(t *testing.T) {
	e := kittest.Setup(t, kittest.Menus, nil)
	org := e.NewOrg()
	mount(e, &fakePos{stock: map[string]float64{}})
	kg, gr := e.Unit("KG", "Kilogram"), e.Unit("GR", "Gram")
	rm := e.RawMaterial(org, "RMB-"+org.BranchID[:4], "Gula BOM", kg, gr, 1000)
	e.Stock(org, rm, org.MainID, 5000, 0.02)
	pid := e.Product(org, org.Stall1ID, "PRB-"+org.BranchID[:4], "Es Kopi", 5000)

	out := e.Call("POST", "/api/purchasing/products/"+pid+"/bom", map[string]any{"raw_material_id": rm, "qty_needed": 200, "waste_persen": 10}, http.StatusCreated)
	bom := obj(out["data"])
	if bom["qty_required"] != "200.0000" || bom["waste_factor"] != "0.1000" || out["message"] != "Bahan berhasil ditambahkan ke BOM" {
		t.Fatalf("bom %v", out)
	}
	e.Fail("POST", "/api/purchasing/products/"+pid+"/bom", map[string]any{"raw_material_id": rm}, http.StatusBadRequest, "Jumlah harus lebih dari 0")
	e.Fail("POST", "/api/purchasing/products/"+pid+"/bom", map[string]any{"raw_material_id": rm, "qty_required": 1}, http.StatusBadRequest,
		"Bahan ini sudah ada di BOM produk")
	e.Fail("POST", "/api/purchasing/products/"+org.MainID+"/bom", map[string]any{"raw_material_id": rm, "qty_required": 1},
		http.StatusNotFound, "Produk tidak ditemukan")
	out = e.Call("GET", "/api/purchasing/products/"+pid+"/bom", nil, http.StatusOK)
	line := obj(out["data"].([]any)[0])
	// 0.02 per gram-equivalent avg cost / 1000 per small unit, × 200 × 1.1.
	if line["cost_per_unit"] != 0.00002 || obj(obj(line["raw_material"])["satuan_kecil"])["id"] != gr ||
		obj(line["raw_material"])["konversi_factor"] != 1000.0 || line["satuan"] != nil {
		t.Fatalf("bom line %v", line)
	}
	out = e.Call("PUT", "/api/purchasing/bom/"+bom["id"].(string), map[string]any{"qty_required": 150}, http.StatusOK)
	if obj(out["data"])["qty_required"] != "150.0000" || out["message"] != "Item BOM berhasil diupdate" {
		t.Fatalf("update %v", out)
	}
	e.Fail("PUT", "/api/purchasing/bom/"+org.MainID, map[string]any{"qty_required": 1}, http.StatusNotFound, "Item BOM tidak ditemukan")
	out = e.Call("DELETE", "/api/purchasing/bom/"+bom["id"].(string), nil, http.StatusOK)
	if out["message"] != "Bahan berhasil dihapus dari BOM" {
		t.Fatal(out)
	}

	cream := e.RawMaterial(org, "RMK-"+org.BranchID[:4], "Krim", kg, "", 1)
	e.Fail("POST", "/api/purchasing/raw-materials/"+cream+"/bom", map[string]any{"component_raw_material_id": cream, "qty_required": 1},
		http.StatusBadRequest, "A raw material cannot be a component of itself")
	out = e.Call("POST", "/api/purchasing/raw-materials/"+cream+"/bom", map[string]any{"component_raw_material_id": rm, "qty_required": 500,
		"satuan_id": gr}, http.StatusCreated)
	comp := obj(out["data"])
	out = e.Call("GET", "/api/purchasing/raw-materials/"+cream+"/bom", nil, http.StatusOK)
	line = obj(out["data"].([]any)[0])
	if line["raw_material_id"] != rm || obj(line["component"])["nama"] != "Gula BOM" || obj(line["satuan"])["id"] != gr ||
		line["total_cost"] != 0.01 {
		t.Fatalf("raw material bom %v", line)
	}
	e.Call("PUT", "/api/purchasing/raw-material-bom/"+comp["id"].(string), map[string]any{"waste_factor": 0.1}, http.StatusOK)
	e.Call("DELETE", "/api/purchasing/raw-material-bom/"+comp["id"].(string), nil, http.StatusOK)
	if rows := e.Call("GET", "/api/purchasing/raw-materials/"+cream+"/bom", nil, http.StatusOK)["data"].([]any); len(rows) != 0 {
		t.Fatalf("after delete %v", rows)
	}
}
