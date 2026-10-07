package posops_test

import (
	"context"
	"testing"
	"time"

	"nuhabit/backend/internal/modules/posops"
	"nuhabit/backend/internal/platform/testutil"
)

// ReceiptStore is pos.pos_receipt_settings for the configuration context's
// settings screen, on the caller's transaction.
func TestReceiptStore(t *testing.T) {
	ctx := context.Background()
	tx := testutil.Tx(t)
	if _, err := tx.Exec(ctx, `UPDATE pos.pos_receipt_settings SET is_active = false`); err != nil {
		t.Fatal(err)
	}
	store := posops.ReceiptStore{}
	at := time.Date(2026, 10, 5, 3, 0, 0, 0, time.UTC)
	if err := store.Insert(ctx, tx, nil, posops.ReceiptInput{HeaderLines: []string{"Halo"}, FooterLines: []string{}, ShowStallName: true}, at); err != nil {
		t.Fatal(err)
	}
	rows, err := store.ActiveRows(ctx, tx)
	if err != nil || len(rows) != 1 || rows[0].BranchID != nil || !rows[0].ShowStallName {
		t.Fatalf("rows = %+v %v", rows, err)
	}
	if header, _ := rows[0].HeaderLines.([]any); len(header) != 1 || header[0] != "Halo" {
		t.Fatalf("header = %#v", rows[0].HeaderLines)
	}
	if err := store.Update(ctx, tx, *rows[0].ID, posops.ReceiptInput{HeaderLines: []string{}, FooterLines: []string{"Terima kasih"}}, at); err != nil {
		t.Fatal(err)
	}
	rows, _ = store.ActiveRows(ctx, tx)
	if footer, _ := rows[0].FooterLines.([]any); len(footer) != 1 || rows[0].ShowStallName {
		t.Fatalf("updated = %+v", rows[0])
	}
}

// Merchandise is the POS merchandise catalog and stock the shop reaches
// through its ports.
func TestMerchandiseCatalog(t *testing.T) {
	ctx := context.Background()
	tx := testutil.Tx(t)
	scalar := func(sql string, args ...any) string {
		t.Helper()
		var v string
		if err := tx.QueryRow(ctx, sql, args...).Scan(&v); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
		return v
	}
	flat := scalar(`INSERT INTO pos.pos_products (sku, name, product_kind, base_price, weight_gram, inventory_quantity, inventory_tracking, is_active, is_available)
		VALUES ($1, 'Aa Go Topi', 'merchandise', 50000, 250, 4, true, true, true) RETURNING id::text`, "GO-"+testutil.RandomHex(4))
	variants := scalar(`INSERT INTO pos.pos_products (sku, name, product_kind, base_price, is_active, is_available)
		VALUES ($1, 'Aa Go Kaos', 'merchandise', 90000, true, true) RETURNING id::text`, "GO-"+testutil.RandomHex(4))
	hidden := scalar(`INSERT INTO pos.pos_products (sku, name, product_kind, base_price, is_active, is_available)
		VALUES ($1, 'Aa Go Habis', 'merchandise', 1, true, false) RETURNING id::text`, "GO-"+testutil.RandomHex(4))
	sku := scalar(`INSERT INTO pos.pos_product_skus (product_id, sku, name, price_override, stock_quantity) VALUES ($1, $2, 'L', 95000, 3) RETURNING id::text`,
		variants, "GO-L-"+testutil.RandomHex(3))
	scalar(`INSERT INTO pos.pos_product_images (product_id, url, display_order) VALUES ($1, '/img/kaos.png', 0) RETURNING id::text`, variants)

	m := posops.Merchandise{}
	products, err := m.Products(ctx, tx, []string{variants, hidden, flat})
	if err != nil || len(products) != 2 || products[0].ID != variants || products[1].ID != flat {
		t.Fatalf("products = %+v %v", products, err)
	}
	if p := products[1]; p.BasePrice != "50000.00" || *p.WeightGram != "250.00" || *p.InventoryQuantity != "4.00" || p.HasActiveSKU {
		t.Errorf("flat = %+v", p)
	}
	if !products[0].HasActiveSKU {
		t.Error("variants have an active SKU")
	}
	skus, _ := m.ActiveSKUs(ctx, tx, []string{variants})
	if len(skus) != 1 || skus[0].ID != sku || *skus[0].PriceOverride != "95000.00" || skus[0].StockQuantity != "3.00" {
		t.Errorf("skus = %+v", skus)
	}
	if got, _ := m.ActiveSKU(ctx, tx, sku, flat); got != nil {
		t.Error("a SKU of another product is not found")
	}
	if images, _ := m.Images(ctx, tx, []string{variants}); len(images) != 1 || images[0].URL != "/img/kaos.png" {
		t.Errorf("images = %+v", images)
	}
	if weight, price, ok, err := m.Cargo(ctx, tx, flat); err != nil || !ok || *weight != "250.00" || price != "50000.00" {
		t.Errorf("cargo = %v %s %v %v", weight, price, ok, err)
	}
	if kind, ok, _ := m.ProductKind(ctx, tx, flat); !ok || kind != "merchandise" {
		t.Errorf("kind = %s", kind)
	}
	names, labels, _ := m.Labels(ctx, tx, []string{flat}, []string{sku})
	if names[flat] != "Aa Go Topi" || labels[sku].Name != "L" {
		t.Errorf("labels = %v %v", names, labels)
	}
	if ok, reason, _ := m.Sell(ctx, tx, variants, nil, 1); ok == nil || *ok || reason != "variant_required" {
		t.Errorf("variant claim = %v %s", ok, reason)
	}
	if ok, _, err := m.Sell(ctx, tx, flat, nil, 3); err != nil || ok == nil || !*ok {
		t.Fatalf("claim = %v %v", ok, err)
	}
	if stock, _ := m.LocalStock(ctx, tx, flat, nil); *stock != "1.00" {
		t.Errorf("stock after claim = %s", *stock)
	}
	if stock, _ := m.LocalStock(ctx, tx, variants, &sku); *stock != "3.00" {
		t.Errorf("sku stock = %s", *stock)
	}
}
