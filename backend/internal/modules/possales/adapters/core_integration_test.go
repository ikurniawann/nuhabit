package adapters

import (
	"context"
	"testing"

	"nuhabit/backend/internal/modules/possales/ports"
	"nuhabit/backend/internal/platform/testutil"
)

func TestCatalog(t *testing.T) {
	tx := testutil.Tx(t)
	ctx := context.Background()
	venue := testutil.CreateOrg(t, tx)
	wh := mustID(t, tx, `INSERT INTO configuration.warehouses (branch_id, name, code) VALUES ($1, 'Stall T', $2) RETURNING id::text`, venue.BranchID, "ST-"+testutil.RandomHex(3))
	kode := "K" + testutil.RandomHex(4)
	master := mustID(t, tx, `INSERT INTO item.products (kode, nama, warehouse_id) VALUES ($1, 'Master', $2) RETURNING id::text`, kode, wh)
	linked := newProduct(t, tx, "Linked", map[string]any{"source_product_id": master, "cost_price": 1234.5})
	bySku := newProduct(t, tx, "By sku", map[string]any{"sku": "PUR-" + kode})
	plain := newProduct(t, tx, "Plain", nil)
	unknown := "00000000-0000-4000-8000-000000000001"

	whs, err := Catalog{}.Warehouses(ctx, tx, []string{linked, bySku, plain, unknown, "", linked})
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]string{linked: wh, bySku: wh, plain: "", unknown: ""}
	if len(whs) != len(want) {
		t.Fatalf("warehouses = %v", whs)
	}
	for k, v := range want {
		if whs[k] != v {
			t.Errorf("warehouse[%s] = %q, want %q", k, whs[k], v)
		}
	}

	costs, err := Catalog{}.CostPrices(ctx, tx, []string{linked, plain, unknown})
	if err != nil {
		t.Fatal(err)
	}
	if costs[linked] != 1234.5 || costs[plain] != 0 || len(costs) != 2 {
		t.Fatalf("costs = %v", costs)
	}

	skus, err := Catalog{}.Skus(ctx, tx, []string{linked, bySku, unknown})
	if err != nil {
		t.Fatal(err)
	}
	if len(skus) != 2 || skus[linked].MasterKode == nil || *skus[linked].MasterKode != kode || skus[bySku].MasterKode != nil ||
		skus[bySku].PosSku == nil || *skus[bySku].PosSku != "PUR-"+kode {
		t.Fatalf("skus = %+v", skus)
	}
	// A bad id fails the lookup without aborting the transaction.
	if skus, err := (Catalog{}).Skus(ctx, tx, []string{"not-a-uuid"}); err != nil || len(skus) != 0 {
		t.Fatalf("bad id skus = %v, %v", skus, err)
	}
	if _, err := (Catalog{}).CostPrices(ctx, tx, []string{plain}); err != nil {
		t.Fatalf("tx unusable after failed lookup: %v", err)
	}
}

func TestMerchandiseAggregate(t *testing.T) {
	got := aggregateMerch([]ports.MerchLine{
		{ProductID: "p1", SkuID: "m", Quantity: 1.0},
		{ProductID: "p1", SkuID: "m", Quantity: "2"},
		{ProductID: "p1", SkuID: "l", Quantity: 1.0},
		{ProductID: "p2", Quantity: 2.0},
		{ProductID: "p1", SkuID: "m", Quantity: 0.0},
		{ProductID: "", SkuID: "l", Quantity: 1.0},
		{ProductID: "p3", Quantity: "abc"},
	})
	want := []ports.MerchClaim{{ProductID: "p1", SkuID: "m", Qty: 3}, {ProductID: "p1", SkuID: "l", Qty: 1}, {ProductID: "p2", Qty: 2}}
	if len(got) != len(want) {
		t.Fatalf("got %+v", got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("got %+v", got)
		}
	}
}

func TestMerchandise(t *testing.T) {
	tx := testutil.Tx(t)
	ctx := context.Background()
	m := Merchandise{}
	stock := func(table, id string) float64 {
		col := "inventory_quantity"
		if table == "pos.pos_product_skus" {
			col = "stock_quantity"
		}
		var n float64
		if err := tx.QueryRow(ctx, `SELECT COALESCE(`+col+`, 0)::float8 FROM `+table+` WHERE id = $1`, id).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	tracked := map[string]any{"product_kind": "merchandise", "inventory_tracking": true, "inventory_quantity": 5}
	flat := newProduct(t, tx, "Kaos", tracked)
	mustExec(t, tx, `INSERT INTO pos.pos_inventory_settings (product_id, allow_negative_stock) VALUES ($1, false)`, flat)
	varianted := newProduct(t, tx, "Topi", tracked)
	sku := mustID(t, tx, `INSERT INTO pos.pos_product_skus (product_id, sku, name, stock_quantity) VALUES ($1, $2, 'M', 4) RETURNING id::text`, varianted, "S-"+testutil.RandomHex(3))
	mustExec(t, tx, `INSERT INTO pos.pos_inventory_settings (product_id, allow_negative_stock) VALUES ($1, false)`, varianted)
	regular := newProduct(t, tx, "Kopi", nil)

	claims, status, reason, err := m.Claim(ctx, tx, []ports.MerchLine{
		{ProductID: flat, Quantity: 2.0}, {ProductID: flat, Quantity: 1.0},
		{ProductID: varianted, SkuID: sku, Quantity: 3.0}, {ProductID: regular, Quantity: 1.0},
	})
	if err != nil || status != 0 || reason != "" || len(claims) != 2 {
		t.Fatalf("claim = %+v %d %q %v", claims, status, reason, err)
	}
	if stock("pos.pos_products", flat) != 2 || stock("pos.pos_product_skus", sku) != 1 {
		t.Fatal("stock not claimed")
	}

	// Insufficient: the earlier claims of the call are restored.
	_, status, reason, _ = m.Claim(ctx, tx, []ports.MerchLine{{ProductID: varianted, SkuID: sku, Quantity: 1.0}, {ProductID: flat, Quantity: 9.0}})
	if status != 400 || reason != "Stok Kaos tidak cukup untuk jumlah yang diminta" || stock("pos.pos_product_skus", sku) != 1 {
		t.Fatalf("insufficient = %d %q", status, reason)
	}
	_, status, reason, _ = m.Claim(ctx, tx, []ports.MerchLine{{ProductID: varianted, Quantity: 1.0}})
	if status != 400 || reason != "Topi punya varian — pilih varian dulu sebelum dijual" {
		t.Fatalf("variant_required = %d %q", status, reason)
	}
	_, status, reason, _ = m.Claim(ctx, tx, []ports.MerchLine{{ProductID: varianted, SkuID: "00000000-0000-4000-8000-000000000001", Quantity: 1.0}})
	if status != 400 || reason != "Varian Topi tidak ditemukan/nonaktif — muat ulang katalog" {
		t.Fatalf("sku_not_found = %d %q", status, reason)
	}
	_, status, reason, _ = m.Claim(ctx, tx, []ports.MerchLine{{ProductID: flat, Quantity: 1.0}, {ProductID: "bad-id", Quantity: 1.0}})
	if status != 500 || reason != "Gagal memproses stok merchandise" || stock("pos.pos_products", flat) != 2 {
		t.Fatalf("rpc error = %d %q", status, reason)
	}

	m.Restore(ctx, tx, claims)
	if stock("pos.pos_products", flat) != 5 || stock("pos.pos_product_skus", sku) != 4 {
		t.Fatal("stock not restored")
	}
	if !m.RestoreOne(ctx, tx, ports.MerchClaim{ProductID: flat, Qty: 1}) || stock("pos.pos_products", flat) != 6 {
		t.Fatal("restore one")
	}
	if m.RestoreOne(ctx, tx, ports.MerchClaim{ProductID: "bad-id", Qty: 1}) {
		t.Fatal("restore of a bad id reported ok")
	}
	if !m.HasTracked(ctx, tx, []string{regular, flat}) || m.HasTracked(ctx, tx, []string{regular}) || m.HasTracked(ctx, tx, nil) {
		t.Fatal("has tracked")
	}
}
