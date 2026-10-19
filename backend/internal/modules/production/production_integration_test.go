package production_test

import (
	"context"
	"net/http"
	"testing"
	"time"

	"nuhabit/backend/internal/app"
	contracts "nuhabit/backend/internal/contracts/production"
	"nuhabit/backend/internal/modules/inventory/kit/kittest"
	"nuhabit/backend/internal/modules/production"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/testutil"
)

// Integration tests on TEST_DATABASE_URL in one rolled-back transaction.
// Catalog and stock run through the real inventory adapters of
// internal/app; the POS port is a fake that records SKU stock and syncs.

var menus = map[string][]string{
	"items.product.production":      {"read", "update"},
	"items.raw-material.production": {"read", "update"},
}

type fakePos struct {
	posProduct string
	skus       []production.Sku
	stock      map[string]float64
	synced     []float64
}

func (f *fakePos) Variants(context.Context, database.Querier, string) (string, []production.Sku, error) {
	return f.posProduct, f.skus, nil
}

func (f *fakePos) AddSkuStock(_ context.Context, _ database.Querier, sku, _ string, qty float64) (float64, bool, error) {
	f.stock[sku] += qty
	return f.stock[sku], true, nil
}

func (f *fakePos) SyncHpp(_ context.Context, _ database.Querier, _ string, hpp float64) (*float64, error) {
	f.synced = append(f.synced, hpp)
	m := 36.7
	return &m, nil
}

type env struct {
	*kittest.T
	org kittest.Org
	pos *fakePos
}

func setup(t *testing.T) *env {
	now := func() time.Time { return time.Date(2026, 10, 19, 3, 0, 0, 0, time.UTC) }
	e := &env{T: kittest.Setup(t, menus, now), pos: &fakePos{stock: map[string]float64{}}}
	e.org = e.NewOrg()
	ports := app.ProductionPorts(now)
	ports.Pos = e.pos
	e.Mount(production.NewOn(e.Deps, e.Tx, ports).Routes())
	return e
}

func obj(v any) map[string]any {
	m, _ := v.(map[string]any)
	return m
}

func list(v any) []any {
	l, _ := v.([]any)
	return l
}

// order inserts a production order and its material lines (qty, unit cost).
func (e *env) order(status, context, outputType string, item string, planned float64, overhead float64, lines ...any) (string, []string) {
	e.Helper()
	number := "PROD-GO-" + testutil.RandomHex(4)
	var product, material any
	if context == "product" {
		product = item
	} else {
		material = item
	}
	id := e.ID(`INSERT INTO manufacturing.production_orders (nomor_produksi, product_id, output_raw_material_id, production_context,
		output_type, planned_qty, status, overhead_cost, company_id, branch_id)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id::text`,
		number, product, material, context, outputType, planned, status, overhead, e.org.CompanyID, e.org.BranchID)
	var ids []string
	for i := 0; i < len(lines); i += 3 {
		ids = append(ids, e.ID(`INSERT INTO manufacturing.production_order_materials (production_order_id, raw_material_id,
			qty_planned, qty_actual, unit_cost, total_cost) VALUES ($1, $2, $3, $3, $4, $3::numeric * $4::numeric) RETURNING id::text`,
			id, lines[i], lines[i+1], lines[i+2]))
	}
	return id, ids
}

func (e *env) num(sql string, args ...any) float64 {
	e.Helper()
	var v float64
	e.Scalar(&v, sql, args...)
	return v
}

func (e *env) events(topic, key string) int {
	e.Helper()
	var n int
	e.Scalar(&n, `SELECT count(*)::int FROM platform.outbox_events WHERE topic = $1 AND key = $2`, topic, key)
	return n
}

func TestIssueAndReceiveBatches(t *testing.T) {
	e := setup(t)
	kg := e.Unit("KG", "Kilogram")
	flour := e.RawMaterial(e.org, "RMF-"+e.org.BranchID[:4], "Tepung", kg, "", 1)
	sugar := e.RawMaterial(e.org, "RMG-"+e.org.BranchID[:4], "Gula", kg, "", 1)
	e.Stock(e.org, flour, e.org.MainID, 10, 10000)
	e.Stock(e.org, sugar, e.org.MainID, 5, 20000)
	product := e.Product(e.org, e.org.Stall1ID, "PRB-"+e.org.BranchID[:4], "Roti", 5000)
	// 10 loaves: 5 kg flour, 1 kg sugar, 5000 conversion cost.
	id, lines := e.order("RELEASED", "product", "FINISHED_GOOD", product, 10, 5000, flour, 5, 10000, sugar, 1, 20000)
	base := "/api/production/orders/" + id

	flow := obj(e.Call("GET", base+"/flow", nil, http.StatusOK)["data"])
	if flow["can_issue"] != true || flow["can_receive"] != false || len(list(flow["materials"])) != 2 {
		t.Fatalf("flow %v", flow)
	}
	e.Fail("POST", base+"/receipts", map[string]any{"qty_good": 1}, http.StatusBadRequest,
		"Hasil produksi hanya bisa diterima saat order IN_PROGRESS")
	e.Fail("POST", base+"/issues", map[string]any{"lines": []any{}}, http.StatusBadRequest, "Pilih minimal satu bahan untuk dikeluarkan")
	short := e.Fail("POST", base+"/issues", map[string]any{"lines": []any{map[string]any{"material_id": lines[0], "qty": 100}}},
		http.StatusBadRequest, "Stok bahan belum cukup untuk dikeluarkan")
	if s := obj(list(obj(short["details"])["shortages"])[0]); s["shortage_qty"] != 90.0 {
		t.Fatalf("shortage %v", short)
	}

	// Issue 1: 3 kg flour and all the sugar; the order starts.
	out := e.Call("POST", base+"/issues", map[string]any{"lines": []any{
		map[string]any{"material_id": lines[0], "qty": 3}, map[string]any{"material_id": lines[1], "qty": 1}}}, http.StatusCreated)
	issue := obj(obj(out["data"])["issue"])
	if issue["total_cost"] != 50000.0 || obj(obj(obj(out["data"])["flow"])["order"])["status"] != "IN_PROGRESS" {
		t.Fatalf("issue %v", out)
	}
	if got := e.num(`SELECT qty_available FROM inventory.inventory WHERE raw_material_id = $1`, flour); got != 7 {
		t.Fatalf("flour stock %v", got)
	}
	if got := e.num(`SELECT count(*) FROM inventory.inventory_movements WHERE reference_type = 'production_issue' AND reference_id = $1`,
		issue["id"]); got != 2 {
		t.Fatalf("movements %v", got)
	}
	if e.events(contracts.TopicMaterialsIssued, issue["id"].(string)) != 1 {
		t.Fatal("issue event")
	}
	out = e.Call("POST", base+"/issues", map[string]any{"lines": []any{map[string]any{"material_id": lines[0], "qty": 2}}}, http.StatusCreated)
	if n := obj(obj(out["data"])["issue"])["nomor_issue"].(string); n[len(n)-3:] != "I02" {
		t.Fatalf("second issue %v", n)
	}

	// WIP holds 70000 of material.
	wip := obj(e.Call("GET", "/api/production/wip?production_context=product", nil, http.StatusOK)["data"])
	var row map[string]any
	for _, r := range list(wip["orders"]) {
		if obj(r)["id"] == id {
			row = obj(r)
		}
	}
	if row == nil || row["wip_value"] != 70000.0 {
		t.Fatalf("wip %v", wip)
	}

	// 2 of 10 planned may be scrapped as normal loss.
	e.Call("PUT", "/api/production/recipe-settings", map[string]any{"product_id": product, "scrap_tolerance_pct": 20}, http.StatusOK)
	// Batch 1: 4 good, 1 scrap at the standard 7000 per unit + 40% of 5000.
	out = e.Call("POST", base+"/receipts", map[string]any{"qty_good": 4, "qty_scrap": 1}, http.StatusCreated)
	b1 := obj(obj(out["data"])["batch"])
	if b1["material_cost"] != 28000.0 || b1["conversion_cost"] != 2000.0 || b1["hpp_per_unit"] != 7500.0 || b1["yield_pct"] != 80.0 {
		t.Fatalf("batch 1 %v", b1)
	}
	if w := obj(obj(obj(out["data"])["flow"])["wip"]); w["wip_value"] != 42000.0 || w["qty_good"] != 4.0 {
		t.Fatalf("wip after batch 1 %v", w)
	}
	// Batch 2 is final with a higher overhead: it takes the rest.
	out = e.Call("POST", base+"/receipts", map[string]any{"qty_good": 4, "qty_scrap": 1, "final": true, "overhead_cost": 6000},
		http.StatusCreated)
	b2 := obj(obj(out["data"])["batch"])
	order := obj(obj(obj(out["data"])["flow"])["order"])
	if b2["material_cost"] != 42000.0 || b2["conversion_cost"] != 4000.0 || b2["hpp_per_unit"] != 11500.0 || b2["is_final"] != true ||
		order["status"] != "COMPLETED" || order["actual_qty"] != 8.0 || order["hpp_per_unit"] != 9500.0 {
		t.Fatalf("batch 2 %v order %v", b2, order)
	}
	if len(e.pos.synced) != 1 || e.pos.synced[0] != 9500 || obj(obj(out["data"])["pos_sync"])["margin_percentage"] != 36.7 {
		t.Fatalf("pos sync %v %v", e.pos.synced, out["data"])
	}
	if qty, cost := e.num(`SELECT qty_available FROM inventory.finished_goods_inventory WHERE product_id = $1`, product),
		e.num(`SELECT unit_cost FROM inventory.finished_goods_inventory WHERE product_id = $1`, product); qty != 8 || cost != 9500 {
		t.Fatalf("finished goods %v @ %v", qty, cost)
	}
	if e.events(contracts.TopicOutputReceived, b2["id"].(string)) != 1 {
		t.Fatal("receipt event")
	}
	e.Fail("POST", base+"/issues", map[string]any{"lines": []any{map[string]any{"material_id": lines[0], "qty": 1}}},
		http.StatusBadRequest, "Bahan hanya bisa dikeluarkan untuk order RELEASED atau IN_PROGRESS")

	batches := list(e.Call("GET", "/api/production/batches?order_id="+id, nil, http.StatusOK)["data"])
	if len(batches) != 2 || obj(batches[0])["batch_number"] != b2["batch_number"] || obj(batches[0])["stepped"] != true {
		t.Fatalf("batches %v", batches)
	}
	detail := obj(e.Call("GET", "/api/production/batches/"+b2["id"].(string), nil, http.StatusOK)["data"])
	// 42000 of material split by issued value: flour 50000, sugar 20000.
	share := map[any]any{}
	for _, m := range list(detail["materials"]) {
		share[obj(m)["raw_material_id"]] = obj(m)["share_cost"]
	}
	if share[flour] != 30000.0 || share[sugar] != 12000.0 || detail["nomor_produksi"] == "" {
		t.Fatalf("batch detail %v", detail)
	}
	e.Fail("GET", "/api/production/batches/"+e.org.MainID, nil, http.StatusNotFound, "Batch produksi tidak ditemukan")
	e.Fail("GET", "/api/production/orders/x/flow", nil, http.StatusNotFound, "Order produksi tidak ditemukan")
}

func TestExplodeMultiLevel(t *testing.T) {
	e := setup(t)
	kg := e.Unit("KG", "Kilogram")
	sfx := e.org.BranchID[:4]
	flour := e.RawMaterial(e.org, "RXF-"+sfx, "Tepung", kg, "", 1)
	milk := e.RawMaterial(e.org, "RXM-"+sfx, "Susu", kg, "", 1)
	cream := e.RawMaterial(e.org, "RXC-"+sfx, "Krim", kg, "", 1)
	e.Stock(e.org, flour, e.org.MainID, 3, 10000)
	e.Stock(e.org, milk, e.org.MainID, 1, 20000)
	product := e.Product(e.org, e.org.Stall1ID, "PRX-"+sfx, "Kue", 5000)
	e.Exec(`INSERT INTO manufacturing.bom_items (product_id, raw_material_id, qty_required, waste_factor) VALUES
		($1, $2, 0.5, 0), ($1, $3, 0.2, 0.1)`, product, flour, cream)
	e.Exec(`INSERT INTO manufacturing.raw_material_bom_items (output_raw_material_id, component_raw_material_id, qty_required)
		VALUES ($1, $2, 0.8)`, cream, milk)

	x := obj(e.Call("GET", "/api/production/bom/explode?product_id="+product+"&qty=10", nil, http.StatusOK)["data"])
	var c map[string]any
	for _, l := range list(x["lines"]) {
		if obj(l)["raw_material_id"] == cream {
			c = obj(l)
		}
	}
	if x["depth"] != 2.0 || obj(x["item"])["nama"] != "Kue" || c["has_recipe"] != true || c["qty_required"] != 2.2 ||
		obj(list(c["children"])[0])["qty_required"] != 1.76 {
		t.Fatalf("explode %v", x)
	}
	leaves := list(x["leaves"])
	if len(leaves) != 2 || obj(leaves[0])["raw_material_id"] != flour || obj(leaves[1])["shortage_qty"] != 0.76 {
		t.Fatalf("leaves %v", leaves)
	}
	// A cycle through the raw material recipes is refused.
	e.Exec(`INSERT INTO manufacturing.raw_material_bom_items (output_raw_material_id, component_raw_material_id, qty_required)
		VALUES ($1, $2, 1)`, milk, cream)
	e.Fail("GET", "/api/production/bom/explode?product_id="+product, nil, http.StatusBadRequest,
		"Resep berputar: RXC-"+sfx+" Krim memakai dirinya sendiri lewat komponennya")
	e.Fail("GET", "/api/production/bom/explode", nil, http.StatusBadRequest, "Isi salah satu: product_id atau raw_material_id")
	e.Fail("GET", "/api/production/bom/explode?raw_material_id="+flour, nil, http.StatusBadRequest, "Item ini belum memiliki resep (BOM)")
}

func TestScrapWipAndVariants(t *testing.T) {
	e := setup(t)
	kg := e.Unit("KG", "Kilogram")
	sfx := e.org.BranchID[:4]
	milk := e.RawMaterial(e.org, "RSM-"+sfx, "Susu", kg, "", 1)
	cream := e.RawMaterial(e.org, "RSC-"+sfx, "Krim", kg, "", 1)
	e.Stock(e.org, milk, e.org.MainID, 10, 20000)

	// A raw material order that yields nothing: the WIP becomes scrap, all
	// of it normal under a 100% tolerance.
	e.Call("PUT", "/api/production/recipe-settings", map[string]any{"raw_material_id": cream, "scrap_tolerance_pct": 100}, http.StatusOK)
	id, lines := e.order("IN_PROGRESS", "raw_material", "FINISHED_GOOD", cream, 2, 0, milk, 1, 20000)
	base := "/api/production/orders/" + id
	e.Fail("POST", base+"/receipts", map[string]any{"qty_good": 1}, http.StatusBadRequest,
		"Keluarkan bahan ke produksi dulu sebelum menerima hasil")
	e.Call("POST", base+"/issues", map[string]any{"lines": []any{map[string]any{"material_id": lines[0], "qty": 1}}}, http.StatusCreated)
	e.Fail("POST", base+"/receipts", map[string]any{"qty_good": 0}, http.StatusBadRequest, "Isi jumlah hasil baik atau scrap")
	out := e.Call("POST", base+"/receipts", map[string]any{"qty_good": 0, "qty_scrap": 2, "final": true}, http.StatusCreated)
	b := obj(obj(out["data"])["batch"])
	if b["scrap_cost"] != 20000.0 || b["total_cost"] != 0.0 || obj(obj(obj(out["data"])["flow"])["order"])["status"] != "COMPLETED" {
		t.Fatalf("scrap batch %v", out)
	}
	if got := e.num(`SELECT count(*) FROM inventory.inventory WHERE raw_material_id = $1`, cream); got != 0 {
		t.Fatalf("scrap posted stock: %v", got)
	}

	// A WIP order puts its output into the product's WIP material.
	product := e.Product(e.org, e.org.Stall1ID, "PRS-"+sfx, "Adonan", 5000)
	id, lines = e.order("RELEASED", "product", "WIP", product, 2, 0, milk, 1, 20000)
	base = "/api/production/orders/" + id
	e.Call("POST", base+"/issues", map[string]any{"lines": []any{map[string]any{"material_id": lines[0], "qty": 1}}}, http.StatusCreated)
	out = e.Call("POST", base+"/receipts", map[string]any{"qty_good": 2, "final": true}, http.StatusCreated)
	wip := obj(obj(out["data"])["batch"])["wip_raw_material_id"].(string)
	if qty, cost := e.num(`SELECT qty_available FROM inventory.inventory WHERE raw_material_id = $1`, wip),
		e.num(`SELECT unit_cost FROM inventory.inventory WHERE raw_material_id = $1`, wip); qty != 2 || cost != 10000 {
		t.Fatalf("wip stock %v @ %v", qty, cost)
	}

	// Finished goods of a merchandise product need the variant split.
	shirt := e.Product(e.org, e.org.Stall1ID, "PRV-"+sfx, "Kaos", 5000)
	posProduct := e.ID(`INSERT INTO pos.pos_products (sku, name, product_kind, source_product_id) VALUES ('KV-'||$2, 'Kaos', 'merchandise', $1)
		RETURNING id::text`, shirt, sfx)
	skuM := e.ID(`INSERT INTO pos.pos_product_skus (product_id, sku, name) VALUES ($1, 'KV-M-'||$2, 'M') RETURNING id::text`, posProduct, sfx)
	skuL := e.ID(`INSERT INTO pos.pos_product_skus (product_id, sku, name) VALUES ($1, 'KV-L-'||$2, 'L') RETURNING id::text`, posProduct, sfx)
	e.pos.posProduct, e.pos.skus = posProduct, []production.Sku{{ID: skuM, Sku: "M", Name: "M"}, {ID: skuL, Sku: "L", Name: "L"}}
	id, lines = e.order("RELEASED", "product", "FINISHED_GOOD", shirt, 2, 0, milk, 1, 20000)
	base = "/api/production/orders/" + id
	e.Call("POST", base+"/issues", map[string]any{"lines": []any{map[string]any{"material_id": lines[0], "qty": 1}}}, http.StatusCreated)
	e.Fail("POST", base+"/receipts", map[string]any{"qty_good": 2}, http.StatusBadRequest, "Rincian varian wajib diisi")
	out = e.Call("POST", base+"/receipts", map[string]any{"qty_good": 2, "final": true, "variant_output": []any{
		map[string]any{"pos_sku_id": skuM, "qty": 1.5}, map[string]any{"pos_sku_id": skuL, "qty": 0.5}}}, http.StatusCreated)
	if e.pos.stock[skuM] != 1.5 || e.pos.stock[skuL] != 0.5 {
		t.Fatalf("sku stock %v", e.pos.stock)
	}
	if got := e.num(`SELECT count(*) FROM inventory.finished_goods_movements WHERE product_id = $1`, shirt); got != 3 {
		t.Fatalf("movements %v", got)
	}
	detail := obj(e.Call("GET", "/api/production/batches/"+obj(obj(out["data"])["batch"])["id"].(string), nil, http.StatusOK)["data"])
	if len(list(detail["variants"])) != 2 {
		t.Fatalf("variants %v", detail)
	}
}

// Scrap above the tolerance (5% of the planned 10 by default) is costed like
// a good unit and expensed; the normal part raises the HPP.
func TestAbnormalScrap(t *testing.T) {
	e := setup(t)
	kg := e.Unit("KG", "Kilogram")
	sfx := e.org.BranchID[:4]
	flour := e.RawMaterial(e.org, "RAF-"+sfx, "Tepung", kg, "", 1)
	e.Stock(e.org, flour, e.org.MainID, 10, 10000)
	product := e.Product(e.org, e.org.Stall1ID, "PRA-"+sfx, "Roti", 5000)

	settings := "/api/production/recipe-settings?product_id=" + product
	got := obj(e.Call("GET", settings, nil, http.StatusOK)["data"])
	if got["scrap_tolerance_pct"] != nil || got["effective_scrap_tolerance_pct"] != 5.0 {
		t.Fatalf("default settings %v", got)
	}
	e.Fail("PUT", "/api/production/recipe-settings", map[string]any{"product_id": product, "scrap_tolerance_pct": 150}, http.StatusBadRequest,
		"Validation failed")
	e.Fail("PUT", "/api/production/recipe-settings", map[string]any{"scrap_tolerance_pct": 1}, http.StatusBadRequest,
		"Isi salah satu: product_id atau raw_material_id")
	e.Fail("GET", "/api/production/recipe-settings?product_id="+e.org.MainID, nil, http.StatusNotFound, "Produk tidak ditemukan")
	got = obj(e.Call("PUT", "/api/production/recipe-settings", map[string]any{"product_id": product, "scrap_tolerance_pct": 10}, http.StatusOK)["data"])
	if got["effective_scrap_tolerance_pct"] != 10.0 {
		t.Fatalf("saved %v", got)
	}
	e.Call("PUT", "/api/production/recipe-settings", map[string]any{"product_id": product, "scrap_tolerance_pct": nil}, http.StatusOK)
	if got = obj(e.Call("GET", settings, nil, http.StatusOK)["data"]); got["scrap_tolerance_pct"] != nil {
		t.Fatalf("cleared %v", got)
	}

	// 10 loaves from 5 kg flour (5000 material and 100 conversion per loaf).
	id, lines := e.order("RELEASED", "product", "FINISHED_GOOD", product, 10, 1000, flour, 5, 10000)
	base := "/api/production/orders/" + id
	e.Call("POST", base+"/issues", map[string]any{"lines": []any{map[string]any{"material_id": lines[0], "qty": 5}}}, http.StatusCreated)

	// Batch 1: 1 scrap, 0.5 within the 0.5 allowance, 0.5 abnormal at 5100.
	out := e.Call("POST", base+"/receipts", map[string]any{"qty_good": 4, "qty_scrap": 1}, http.StatusCreated)
	b1 := obj(obj(out["data"])["batch"])
	if b1["qty_scrap_normal"] != 0.5 || b1["qty_scrap_abnormal"] != 0.5 || b1["abnormal_material_cost"] != 2500.0 ||
		b1["abnormal_conversion_cost"] != 50.0 || b1["abnormal_scrap_cost"] != 2550.0 || b1["hpp_per_unit"] != 5100.0 ||
		b1["scrap_tolerance_pct"] != 5.0 {
		t.Fatalf("batch 1 %v", b1)
	}
	w := obj(obj(obj(out["data"])["flow"])["wip"])
	if w["wip_value"] != 27500.0 || w["scrap_allowance"] != 0.5 || w["qty_scrap_abnormal"] != 0.5 || w["conversion_applied"] != 450.0 {
		t.Fatalf("wip after batch 1 %v", w)
	}
	// Batch 2 (final): the allowance is used up, so its 1 scrap is abnormal
	// and takes 1/5 of what is left.
	out = e.Call("POST", base+"/receipts", map[string]any{"qty_good": 4, "qty_scrap": 1, "final": true}, http.StatusCreated)
	b2 := obj(obj(out["data"])["batch"])
	if b2["material_cost"] != 22000.0 || b2["abnormal_material_cost"] != 5500.0 || b2["conversion_cost"] != 440.0 ||
		b2["abnormal_conversion_cost"] != 110.0 || b2["hpp_per_unit"] != 5610.0 {
		t.Fatalf("batch 2 %v", b2)
	}
	var payload map[string]any
	e.Scalar(&payload, `SELECT payload FROM platform.outbox_events WHERE topic = $1 AND key = $2`, contracts.TopicOutputReceived, b2["id"])
	if payload["abnormal_scrap_cost"] != 5610.0 || payload["abnormal_conversion_cost"] != 110.0 {
		t.Fatalf("event %v", payload)
	}
	detail := obj(e.Call("GET", "/api/production/batches/"+b2["id"].(string), nil, http.StatusOK)["data"])
	if obj(list(detail["materials"])[0])["share_cost"] != 27500.0 || detail["abnormal_scrap_cost"] != 5610.0 {
		t.Fatalf("batch detail %v", detail)
	}
}

// The explosion, the order and the issue count in the stock unit: a recipe
// of 0.25 kg flour per loaf, flour stocked in grams.
func TestStockUnits(t *testing.T) {
	e := setup(t)
	kg, gr := e.Unit("KG", "Kilogram"), e.Unit("GR", "Gram")
	sfx := e.org.BranchID[:4]
	flour := e.RawMaterial(e.org, "RUF-"+sfx, "Tepung", kg, gr, 1000)
	e.Stock(e.org, flour, e.org.MainID, 1500, 20)
	product := e.Product(e.org, e.org.Stall1ID, "PRU-"+sfx, "Roti", 5000)
	e.Exec(`INSERT INTO manufacturing.bom_items (product_id, raw_material_id, qty_required, satuan_id) VALUES ($1, $2, 0.25, $3)`, product, flour, kg)

	x := obj(e.Call("GET", "/api/production/bom/explode?product_id="+product+"&qty=4", nil, http.StatusOK)["data"])
	line := obj(list(x["lines"])[0])
	if line["qty_required"] != 1000.0 || line["qty_per_parent"] != 250.0 || line["satuan"] != "Gram" || line["recipe_qty_per"] != 0.25 ||
		line["recipe_satuan"] != "Kilogram" || line["unit_factor"] != 1000.0 || line["total_cost"] != 20000.0 ||
		obj(list(x["leaves"])[0])["qty_required"] != 1000.0 {
		t.Fatalf("explode %v", line)
	}

	out := e.Call("POST", "/api/purchasing/production/orders", map[string]any{"product_id": product, "planned_qty": 4}, http.StatusCreated)
	id := obj(out["data"])["id"].(string)
	e.Call("PATCH", "/api/purchasing/production/orders/"+id, map[string]any{"action": "release"}, http.StatusOK)
	flow := obj(e.Call("GET", "/api/production/orders/"+id+"/flow", nil, http.StatusOK)["data"])
	m := obj(list(flow["materials"])[0])
	if m["qty_planned"] != 1000.0 || m["satuan"] != "Gram" || m["recipe_qty"] != 1.0 || m["recipe_satuan"] != "Kilogram" || m["unit_factor"] != 1000.0 {
		t.Fatalf("flow material %v", m)
	}
	e.Call("POST", "/api/production/orders/"+id+"/issues", map[string]any{"lines": []any{map[string]any{"material_id": m["id"], "qty": 1000}}},
		http.StatusCreated)
	if got := e.num(`SELECT qty_available FROM inventory.inventory WHERE raw_material_id = $1`, flour); got != 500 {
		t.Fatalf("flour stock %v g", got)
	}

	// An order written before the conversion keeps its stored quantities.
	old, _ := e.order("RELEASED", "product", "FINISHED_GOOD", product, 1, 0, flour, 0.25, 20)
	m = obj(list(obj(e.Call("GET", "/api/production/orders/"+old+"/flow", nil, http.StatusOK)["data"])["materials"])[0])
	if m["qty_planned"] != 0.25 || m["recipe_qty"] != nil || m["unit_factor"] != nil {
		t.Fatalf("legacy line %v", m)
	}
}

func TestProductionNeedsMenus(t *testing.T) {
	e := setup(t)
	outsider := testutil.CreateStaff(t, testutil.StaffOptions{Menus: map[string][]string{"pos.catalog": nil}})
	reader := testutil.CreateStaff(t, testutil.StaffOptions{Menus: map[string][]string{"items.product.production": nil}})
	call := func(s testutil.Staff, method, path string, body any) int {
		rec, _ := testutil.Do(t, e.Mux, testutil.AsStaff(testutil.Request(method, path, body), s))
		return rec.Code
	}
	if got := call(outsider, "GET", "/api/production/wip", nil); got != http.StatusForbidden {
		t.Fatalf("outsider wip %d", got)
	}
	if got := call(reader, "POST", "/api/production/orders/"+e.org.MainID+"/issues", map[string]any{}); got != http.StatusForbidden {
		t.Fatalf("reader issue %d", got)
	}
}
