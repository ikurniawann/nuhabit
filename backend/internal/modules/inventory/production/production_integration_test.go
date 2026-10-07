package production_test

import (
	"context"
	"net/http"
	"slices"
	"testing"
	"time"

	"nuhabit/backend/internal/modules/inventory/domain"
	"nuhabit/backend/internal/modules/inventory/kit"
	"nuhabit/backend/internal/modules/inventory/kit/kittest"
	"nuhabit/backend/internal/modules/inventory/production"
	"nuhabit/backend/internal/platform/database"
)

// Integration tests on TEST_DATABASE_URL in one rolled-back transaction.
// Response shapes and database effects were also diffed against the TS
// routes on seeded data (product, raw material, WIP and variant orders).

type fakePos struct {
	posProduct string
	skus       []production.Sku
	stock      map[string]float64
	synced     int
}

func (f *fakePos) MerchandiseSkus(context.Context, database.Querier, string) (string, []production.Sku, error) {
	return f.posProduct, f.skus, nil
}

func (f *fakePos) AddSkuStock(_ context.Context, _ database.Querier, sku, _ string, qty float64) (float64, bool, error) {
	f.stock[sku] += qty
	return f.stock[sku], true, nil
}

func (f *fakePos) SkuLabels(context.Context, database.Querier, []string) (map[string]production.Sku, error) {
	out := map[string]production.Sku{}
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

func TestProductOrderLifecycle(t *testing.T) {
	e := kittest.Setup(t, kittest.Menus, func() time.Time { return time.Date(2026, 10, 4, 3, 0, 0, 0, time.UTC) })
	org := e.NewOrg()
	e.ScopeStaff("branch", org)
	pos := &fakePos{stock: map[string]float64{}}
	e.Mount(production.Routes(e.Env, production.Ports{Pos: pos, Receipts: fakeReceipts{}}))
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
	if d["status"] != "COMPLETED" || len(d["batches"].([]any)) != 1 || obj(d["stock_summary"])["total_materials"] != 1.0 {
		t.Fatalf("detail %v", d)
	}
	out = e.Call("GET", "/api/purchasing/production/orders?search=Nasi", nil, http.StatusOK)
	if len(out["data"].([]any)) != 1 {
		t.Fatalf("list %v", out)
	}
	e.Fail("GET", "/api/purchasing/production/orders/"+org.MainID, nil, http.StatusNotFound, "Production order not found")

	out = e.Call("GET", "/api/purchasing/cogs/product/"+product, nil, http.StatusOK)
	c := obj(out["data"])
	// 0.2 × 1.1 kg at 12000 = 2640, +10% overhead.
	if c["total_bom_cost"] != 2640.0 || c["hpp_per_unit"] != 2904.0 || c["margin_label"] != "Healthy" {
		t.Fatalf("cogs %v", c)
	}
	e.Fail("GET", "/api/purchasing/cogs/product/x", nil, http.StatusBadRequest, "Invalid product ID")
	out = e.Call("GET", "/api/purchasing/production/product-recipes", nil, http.StatusOK)
	if r := obj(out["data"].([]any)[0]); r["total_bahan_baku"] != 1.0 {
		t.Fatalf("recipes %v", r)
	}
}

func TestVariantSplitAndAdditionalCosts(t *testing.T) {
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
	pos := &fakePos{posProduct: posProduct, skus: []production.Sku{{ID: skuM, Sku: "M", Name: "M"}, {ID: skuL, Sku: "L", Name: "L"}},
		stock: map[string]float64{}}
	e.Mount(production.Routes(e.Env, production.Ports{Pos: pos, Receipts: fakeReceipts{}}))
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

// fakeReceipts stands in for procurement: received lines of raw materials
// and the PO/GRN numbers (the SQL adapter is tested in internal/app).
type fakeReceipts struct {
	lines   []domain.ReceiptLine
	totals  map[string]float64
	numbers map[string]string
}

func (f fakeReceipts) ReceivedValues(_ context.Context, _ database.Querier, ids []string) ([]domain.ReceiptLine, map[string]float64, error) {
	var out []domain.ReceiptLine
	for _, l := range f.lines {
		if slices.Contains(ids, l.MaterialID) {
			out = append(out, l)
		}
	}
	return out, f.totals, nil
}

func (f fakeReceipts) DocumentNumbers(_ context.Context, _ database.Querier, refs []production.DocRef) (map[string]string, error) {
	out := map[string]string{}
	for _, r := range refs {
		if n, ok := f.numbers[domain.DocKey(r.Type, r.ID)]; ok {
			out[domain.DocKey(r.Type, r.ID)] = n
		}
	}
	return out, nil
}

// Freight on a GRN raises the HPP of the products made from what it brought.
func TestAdditionalCostsInCogs(t *testing.T) {
	e := kittest.Setup(t, kittest.Menus, nil)
	org := e.NewOrg()
	kg := e.Unit("KG", "Kilogram")
	rm := e.RawMaterial(org, "RML-"+org.BranchID[:4], "Beras", kg, "", 1)
	e.Stock(org, rm, org.MainID, 10, 12000)
	product := e.Product(org, org.Stall1ID, "PRL-"+org.BranchID[:4], "Nasi", 5000)
	e.Exec(`INSERT INTO manufacturing.bom_items (product_id, raw_material_id, qty_required, waste_factor) VALUES ($1, $2, 0.2, 0.1)`, product, rm)
	po, grn := e.ID(`SELECT gen_random_uuid()::text`), e.ID(`SELECT gen_random_uuid()::text`)
	receipts := fakeReceipts{
		lines:   []domain.ReceiptLine{{GrnID: grn, PoID: po, MaterialID: rm, Value: 120000}},
		totals:  map[string]float64{"GRN:" + grn: 120000, "PO:" + po: 120000},
		numbers: map[string]string{"GRN:" + grn: "GRN-GO-1", "PO:" + po: "PO-GO-1"},
	}
	e.Mount(production.Routes(e.Env, production.Ports{Pos: &fakePos{stock: map[string]float64{}}, Receipts: receipts}))
	base := "/api/purchasing/cogs/additional-cost"

	e.Fail("POST", base, map[string]any{"reference_type": "SO", "tipe_biaya": "freight", "jumlah": 1}, http.StatusBadRequest, "Validation failed")
	e.Fail("POST", base, map[string]any{"reference_type": "PO", "reference_id": grn, "tipe_biaya": "freight", "jumlah": 1}, http.StatusNotFound, "PO tidak ditemukan")
	out := e.Call("POST", base, map[string]any{"reference_type": "GRN", "reference_id": grn, "tipe_biaya": "freight", "jumlah": 10,
		"currency": "USD", "exchange_rate": 1200, "deskripsi": "Ongkir", "tanggal_transaksi": "2026-10-03"}, http.StatusCreated)
	cost := obj(out["data"])
	if out["message"] != "Biaya tambahan berhasil ditambahkan" || cost["reference_number"] != "GRN-GO-1" || cost["jumlah"] != "10.00" ||
		cost["jumlah_idr"] != "12000.00" || cost["currency"] != "USD" || cost["tanggal_transaksi"] != "2026-10-03" || cost["deskripsi"] != "Ongkir" {
		t.Fatalf("create %v", out)
	}
	list := e.Call("GET", base+"?reference_type=GRN&reference_id="+grn, nil, http.StatusOK)
	if rows := list["data"].([]any); len(rows) != 1 || obj(rows[0])["id"] != cost["id"] || obj(list["pagination"])["total"] != 1.0 {
		t.Fatalf("list %v", list)
	}
	if rows := e.Call("GET", base+"?reference_type=PO&reference_id="+po, nil, http.StatusOK)["data"].([]any); len(rows) != 0 {
		t.Fatalf("PO filter %v", rows)
	}

	// 12000 freight on 120000 of rice is a 10% landed cost: 0.22 kg × 12000 × 10% = 264 per unit.
	c := obj(e.Call("GET", "/api/purchasing/cogs/product/"+product, nil, http.StatusOK)["data"])
	line := obj(c["breakdown_bahan"].([]any)[0])
	if c["total_bom_cost"] != 2640.0 || c["total_additional_cost"] != 264.0 || c["total_overhead"] != 290.4 || c["hpp_per_unit"] != 3194.4 ||
		line["additional_cost"] != 264.0 || line["landed_cost_rate"] != 10.0 {
		t.Fatalf("cogs with landed cost %v", c)
	}

	e.Call("DELETE", base+"/"+cost["id"].(string), nil, http.StatusOK)
	e.Fail("DELETE", base+"/"+cost["id"].(string), nil, http.StatusNotFound, "Biaya tambahan tidak ditemukan")
	if c := obj(e.Call("GET", "/api/purchasing/cogs/product/"+product, nil, http.StatusOK)["data"]); c["hpp_per_unit"] != 2904.0 || c["total_additional_cost"] != 0.0 {
		t.Fatalf("cogs after delete %v", c)
	}
}
