package shop

import (
	"strings"
	"testing"

	"nuhabit/backend/internal/platform/testutil"
)

// Wave 2 of the storefront: sale pricing, stock badges, related products,
// reviews and wishlists.

// catalogProduct fetches the storefront catalog and returns the product's view.
func catalogProduct(f *fixture, base, product string) map[string]any {
	f.t.Helper()
	res, out := f.do("GET", base+"/catalog", nil)
	expectStatus(f.t, res, 200)
	for _, p := range out["data"].(map[string]any)["products"].([]any) {
		if view := p.(map[string]any); view["id"] == product {
			return view
		}
	}
	f.t.Fatalf("product %s missing from the catalog", product)
	return nil
}

func TestSalePricingCatalogAndCheckout(t *testing.T) {
	f := newFixture(t)
	f.svc.biteshipBase = fakeBiteship(t).URL
	f.env["BITESHIP_API_KEY"] = "bs-key"
	f.exec(`UPDATE shop.shipping_settings SET is_active = false`)
	f.exec(`INSERT INTO shop.shipping_settings (provider, origin_area_id, couriers, markup_amount) VALUES ('biteship', 'ORIGIN', 'jne', 2500)`)
	base, product := storefrontFixture(f)
	over := "65000"
	// Real SKU rows: order items reference them.
	skuL := f.scalar(`INSERT INTO pos.pos_product_skus (product_id, sku, name, stock_quantity) VALUES ($1::uuid, $2, 'L', 3) RETURNING id::text`, product, "GO-L-"+testutil.RandomHex(4))
	skuXL := f.scalar(`INSERT INTO pos.pos_product_skus (product_id, sku, name, stock_quantity, price_override) VALUES ($1::uuid, $2, 'XL', 2, 65000) RETURNING id::text`, product, "GO-XL-"+testutil.RandomHex(4))
	f.svc.ports.Catalog = fakeCatalog{products: f.catalog.products, skus: []CatalogSKU{
		{ID: skuL, ProductID: product, SKU: "K-L", Name: "L", StockQuantity: "3"},
		{ID: skuXL, ProductID: product, SKU: "K-XL", Name: "XL", PriceOverride: &over, StockQuantity: "2"},
	}}

	// Staff set the sale through the product settings route.
	res, out := f.staff("PATCH", "/api/shop/wholesale/products/"+product, map[string]any{
		"sale_price_idr": 40000, "sale_until": "2099-01-01T00:00:00.000Z", "is_featured": true, "is_new": true})
	expectStatus(t, res, 200)
	row := out["data"].(map[string]any)
	if row["price"] != 50000.0 || row["sale_price_idr"] != 40000.0 || row["sale_until"] != "2099-01-01T00:00:00.000Z" || row["is_featured"] != true || row["is_new"] != true {
		t.Errorf("settings row = %v", row)
	}
	res, _ = f.staff("PATCH", "/api/shop/wholesale/products/"+product, map[string]any{"sale_price_idr": 40000, "sale_until": "soon"})
	expectStatus(t, res, 400)

	view := catalogProduct(f, base, product)
	if view["price"] != 40000.0 || view["compareAtPrice"] != 50000.0 || view["salePercent"] != 20.0 || view["saleUntil"] != "2099-01-01T00:00:00.000Z" ||
		view["isFeatured"] != true || view["isNew"] != true {
		t.Errorf("sale product = %v", view)
	}
	skus := view["skus"].([]any)
	l, xl := skus[0].(map[string]any), skus[1].(map[string]any)
	if l["price"] != 40000.0 || l["compareAtPrice"] != 50000.0 || xl["price"] != 52000.0 || xl["compareAtPrice"] != 65000.0 {
		t.Errorf("sale skus = %v %v", l, xl)
	}

	// Promo preview, checkout, invoice, WhatsApp and the status page use
	// the sale price.
	lines := []map[string]any{{"productId": product, "skuId": skuXL, "quantity": 1}}
	f.promo.discount = 2000
	res, _ = f.do("POST", base+"/promo/preview", map[string]any{"code": "LAUNCH", "lines": lines})
	expectStatus(t, res, 200)
	if got := f.promo.lastCheck; got.Subtotal != 52000 || len(got.Lines) != 1 || got.Lines[0].Amount != 52000 {
		t.Errorf("promo check = %+v", got)
	}
	body := map[string]any{
		"items":       []map[string]any{{"product_id": product, "sku_id": skuXL, "quantity": 1}, {"product_id": product, "sku_id": skuL, "quantity": 1}},
		"customer":    map[string]any{"name": "Budi", "phone": "081234567890"},
		"destination": map[string]any{"area_id": "IDNP6", "label": "Coblong, Bandung", "address": "Jl. Dago 1 no 10"},
		"courier":     map[string]any{"code": "jne", "service_code": "reg"},
	}
	res, out = f.do("POST", base+"/checkout", body)
	expectStatus(t, res, 201)
	number := out["data"].(map[string]any)["order_number"].(string)
	if got := f.scalar(`SELECT subtotal || '|' || total FROM shop.orders WHERE order_number = $1`, number); got != "92000.00|104500.00" {
		t.Errorf("order = %s", got)
	}
	if got := f.scalar(`SELECT string_agg(sku_name || ':' || unit_price, ',' ORDER BY sku_name) FROM shop.order_items i JOIN shop.orders o ON o.id = i.order_id WHERE o.order_number = $1`, number); got != "L:40000.00,XL:52000.00" {
		t.Errorf("items = %s", got)
	}
	if f.pay.invoices[0].Amount != 104500 || !strings.Contains(f.wa.sent[0], "Total: Rp104.500") {
		t.Errorf("invoice = %+v wa = %v", f.pay.invoices[0], f.wa.sent)
	}

	// Partners keep the regular price.
	f.exec(`UPDATE shop.storefronts SET is_default = false`)
	f.exec(`UPDATE shop.storefronts SET is_default = true WHERE slug = $1`, strings.TrimPrefix(base, "/api/public/shop/"))
	res, out = f.staff("GET", "/api/shop/wholesale/products", nil)
	expectStatus(t, res, 200)
	if got := out["data"].([]any)[0].(map[string]any); got["price"] != 50000.0 {
		t.Errorf("staff product price = %v", got["price"])
	}

	// An expired sale prices at the regular price again, with no badge.
	f.exec(`UPDATE shop.product_settings SET sale_until = now() - interval '1 minute' WHERE product_id = $1::uuid`, product)
	view = catalogProduct(f, base, product)
	if view["price"] != 50000.0 || view["compareAtPrice"] != nil || view["salePercent"] != nil || view["saleUntil"] != nil {
		t.Errorf("expired sale product = %v", view)
	}
	res, out = f.do("POST", base+"/checkout", body)
	expectStatus(t, res, 201)
	if got := f.scalar(`SELECT subtotal FROM shop.orders WHERE order_number = $1`, out["data"].(map[string]any)["order_number"].(string)); got != "115000.00" {
		t.Errorf("expired sale subtotal = %s", got)
	}
}

func TestStockBadgesAndRelatedProducts(t *testing.T) {
	f := newFixture(t)
	base, product := storefrontFixture(f)
	tees, hoodies := "c-tees", "c-hoodies"
	// product sits in the tees collection with 3 in stock, under the
	// default low-stock threshold.
	stock := "3"
	p := f.catalog.products[product]
	p.InventoryQuantity, p.CategoryID, p.CategoryName = &stock, &tees, &tees
	f.catalog.products[product] = p
	newProduct := func(name, stock, collection string, ageDays int) string {
		id := f.scalar(`INSERT INTO pos.pos_products (sku, name, product_kind, inventory_quantity)
			VALUES ($1, $2, 'merchandise', $3::numeric) RETURNING id::text`, "GO-"+testutil.RandomHex(4), name, stock)
		f.catalog.products[id] = WebProduct{ID: id, Name: name, BasePrice: "50000", InventoryQuantity: &stock, CategoryID: &collection, CategoryName: &collection,
			CreatedAt: f.svc.now().AddDate(0, 0, -ageDays)}
		return id
	}
	oldTee := newProduct("Old tee", "10", tees, 30)
	newTee := newProduct("New tee", "10", tees, 1)
	soldOutTee := newProduct("Sold out tee", "0", tees, 0)
	hoodie := newProduct("Hoodie", "10", hoodies, 0)

	view := catalogProduct(f, base, product)
	if view["lowStock"] != true || view["backInStock"] != false {
		t.Errorf("badges = %v %v", view["lowStock"], view["backInStock"])
	}
	// In stock first, newest first, same collection only.
	related := view["relatedIds"].([]any)
	if len(related) != 3 || related[0] != newTee || related[1] != oldTee || related[2] != soldOutTee {
		t.Errorf("relatedIds = %v", related)
	}
	if got := catalogProduct(f, base, hoodie)["relatedIds"].([]any); len(got) != 0 {
		t.Errorf("hoodie relatedIds = %v", got)
	}

	// A higher threshold from the settings; 0 turns the badge off.
	f.exec(`INSERT INTO shop.storefront_settings (storefront_id, low_stock_threshold) SELECT id, 10 FROM shop.storefronts WHERE slug = $1`, strings.TrimPrefix(base, "/api/public/shop/"))
	if catalogProduct(f, base, oldTee)["lowStock"] != true {
		t.Error("lowStock at threshold 10")
	}
	f.exec(`UPDATE shop.storefront_settings SET low_stock_threshold = 0`)
	if catalogProduct(f, base, product)["lowStock"] != false {
		t.Error("lowStock with the badge off")
	}

	// A stock write from 0 to above 0 stamps restocked_at (product and SKU
	// triggers); the badge lasts 7 days.
	f.exec(`UPDATE pos.pos_products SET inventory_quantity = 4 WHERE id = $1::uuid`, soldOutTee)
	restocked := "4"
	p = f.catalog.products[soldOutTee]
	p.InventoryQuantity = &restocked
	f.catalog.products[soldOutTee] = p
	if catalogProduct(f, base, soldOutTee)["backInStock"] != true {
		t.Error("backInStock after a restock")
	}
	f.exec(`UPDATE pos.pos_products SET inventory_quantity = 9 WHERE id = $1::uuid`, oldTee)
	if catalogProduct(f, base, oldTee)["backInStock"] != false {
		t.Error("a stock change above zero is not a restock")
	}
	f.exec(`UPDATE shop.product_settings SET restocked_at = now() - interval '8 days' WHERE product_id = $1::uuid`, soldOutTee)
	if catalogProduct(f, base, soldOutTee)["backInStock"] != false {
		t.Error("backInStock after the window")
	}
	sku := f.scalar(`INSERT INTO pos.pos_product_skus (product_id, sku, name, stock_quantity) VALUES ($1::uuid, $2, 'M', 0) RETURNING id::text`, hoodie, "GO-"+testutil.RandomHex(4))
	f.exec(`UPDATE pos.pos_product_skus SET stock_quantity = 2 WHERE id = $1::uuid`, sku)
	if got := f.scalar(`SELECT (restocked_at > now() - interval '1 minute')::text FROM shop.product_settings WHERE product_id = $1::uuid`, hoodie); got != "true" {
		t.Errorf("sku restock = %s", got)
	}
}

func TestProductReviews(t *testing.T) {
	member, stranger := testutil.CreateMember(t), testutil.CreateMember(t)
	f := newFixture(t)
	base, product := storefrontFixture(f)
	otherProduct := f.scalar(`INSERT INTO pos.pos_products (sku, name, product_kind) VALUES ($1, 'Topi', 'merchandise') RETURNING id::text`, "GO-"+testutil.RandomHex(4))
	order := f.order("pending", "customer_id", "'"+member.CustomerID+"'")
	f.exec(`INSERT INTO shop.order_items (order_id, product_id, product_name, quantity, unit_price, total) VALUES ($1::uuid, $2::uuid, 'Kaos', 1, 50000, 50000)`, order, product)
	f.exec(`INSERT INTO shop.order_items (order_id, product_id, product_name, quantity, unit_price, total) VALUES ($1::uuid, NULL, 'Gift wrap', 1, 5000, 5000)`, order)
	token := f.scalar(`SELECT access_token::text FROM shop.orders WHERE id = $1`, order)
	review := map[string]any{"orderToken": token, "productId": product, "rating": 5, "comment": " Fits well. "}
	post := func(body map[string]any, memberID string) (int, map[string]any) {
		res, out := f.do("POST", base+"/reviews", body, "X-Test-Member", memberID)
		return res.Code, out
	}

	// A guest, an unpaid order, another member and a product outside the
	// order are all refused.
	res, _ := f.do("POST", base+"/reviews", review)
	expectStatus(t, res, 401)
	expectJSON(t, res, `{"success":false,"error":"Sign in to write a review"}`)
	if code, out := post(review, member.CustomerID); code != 403 || out["error"] != "You can review products from your paid orders only" {
		t.Errorf("unpaid order: %d %v", code, out)
	}
	items := func() []any {
		res, out := f.do("GET", "/api/public/shop/order/"+token, nil)
		expectStatus(t, res, 200)
		return out["data"].(map[string]any)["items"].([]any)
	}
	if got := items(); got[1].(map[string]any)["reviewable"] != false || got[1].(map[string]any)["productId"] != product {
		t.Errorf("unpaid items = %v", got)
	}
	f.exec(`UPDATE shop.orders SET status = 'paid', paid_at = now() WHERE id = $1::uuid`, order)
	if got := items(); got[0].(map[string]any)["reviewable"] != false || got[1].(map[string]any)["reviewable"] != true {
		t.Errorf("paid items = %v", got)
	}
	if code, _ := post(review, stranger.CustomerID); code != 403 {
		t.Errorf("another member: %d", code)
	}
	if code, _ := post(map[string]any{"orderToken": token, "productId": otherProduct, "rating": 4}, member.CustomerID); code != 403 {
		t.Errorf("product outside the order: %d", code)
	}
	if code, _ := post(map[string]any{"orderToken": token, "productId": product, "rating": 6}, member.CustomerID); code != 400 {
		t.Errorf("rating 6: %d", code)
	}

	code, out := post(review, member.CustomerID)
	if code != 200 {
		t.Fatalf("create: %d %v", code, out)
	}
	created := out["data"].(map[string]any)
	if created["status"] != "pending" || created["comment"] != "Fits well." || created["rating"] != 5.0 || created["productId"] != product {
		t.Errorf("created = %v", created)
	}
	if code, out := post(review, member.CustomerID); code != 409 || out["error"] != "You have already reviewed this product" {
		t.Errorf("duplicate: %d %v", code, out)
	}
	if got := items(); got[1].(map[string]any)["reviewable"] != false {
		t.Error("reviewed item stays reviewable")
	}

	// Pending reviews are invisible; publishing lists them and rates the
	// product in the catalog.
	res, _ = f.do("GET", base+"/products/"+product+"/reviews", nil)
	expectStatus(t, res, 200)
	expectJSON(t, res, `{"success":true,"data":[]}`)
	if catalogProduct(f, base, product)["rating"] != nil {
		t.Error("pending review rates the product")
	}
	res, _ = f.do("GET", "/api/shop/reviews?status=pending", nil)
	expectStatus(t, res, 401)
	res, out = f.staff("GET", "/api/shop/reviews?status=pending", nil)
	expectStatus(t, res, 200)
	rows := out["data"].([]any)
	if len(rows) != 1 || rows[0].(map[string]any)["product_name"] != "Kaos" || rows[0].(map[string]any)["customer_name"] != "Budi" || rows[0].(map[string]any)["status"] != "pending" {
		t.Errorf("moderation list = %v", rows)
	}
	id := created["id"].(string)
	res, _ = f.staff("PATCH", "/api/shop/reviews/"+id, map[string]any{"status": "live"})
	expectStatus(t, res, 400)
	res, _ = f.staff("PATCH", "/api/shop/reviews/00000000-0000-4000-8000-000000000009", map[string]any{"status": "published"})
	expectStatus(t, res, 404)
	res, _ = f.staff("PATCH", "/api/shop/reviews/"+id, map[string]any{"status": "published"})
	expectStatus(t, res, 200)
	expectJSON(t, res, `{"success":true,"data":{"id":"`+id+`","status":"published"}}`)
	res, out = f.staff("GET", "/api/shop/reviews?status=pending", nil)
	if len(out["data"].([]any)) != 0 {
		t.Error("published review still pending")
	}
	res, out = f.do("GET", base+"/products/"+product+"/reviews", nil)
	expectStatus(t, res, 200)
	listed := out["data"].([]any)[0].(map[string]any)
	if listed["author"] != "Budi" || listed["rating"] != 5.0 || listed["comment"] != "Fits well." || listed["createdAt"] == nil {
		t.Errorf("listed = %v", listed)
	}
	// A second published review averages to one decimal.
	f.exec(`INSERT INTO shop.product_reviews (product_id, customer_id, order_id, rating, status) VALUES ($1::uuid, $2::uuid, $3::uuid, 4, 'published')`, product, stranger.CustomerID, order)
	if got := catalogProduct(f, base, product)["rating"].(map[string]any); got["average"] != 4.5 || got["count"] != 2.0 {
		t.Errorf("rating = %v", got)
	}
	f.exec(`INSERT INTO shop.product_reviews (product_id, customer_id, order_id, rating, status) VALUES ($1::uuid, $2::uuid, $3::uuid, 1, 'rejected')`, otherProduct, stranger.CustomerID, order)
	res, out = f.staff("GET", "/api/shop/reviews", nil)
	if len(out["data"].([]any)) != 3 {
		t.Errorf("all reviews = %v", out["data"])
	}
}

func TestWishlistRoundTrip(t *testing.T) {
	member := testutil.CreateMember(t)
	f := newFixture(t)
	base, product := storefrontFixture(f)
	other := "6a1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f"

	res, _ := f.do("GET", base+"/wishlist", nil)
	expectStatus(t, res, 401)
	expectJSON(t, res, `{"success":false,"error":"Sign in to save your wishlist"}`)
	res, _ = f.do("PUT", base+"/wishlist", map[string]any{"productIds": []string{product}})
	expectStatus(t, res, 401)

	res, _ = f.do("GET", base+"/wishlist", nil, "X-Test-Member", member.CustomerID)
	expectStatus(t, res, 200)
	expectJSON(t, res, `{"success":true,"data":{"productIds":[]}}`)
	res, _ = f.do("PUT", base+"/wishlist", map[string]any{"productIds": []string{product, other, product}}, "X-Test-Member", member.CustomerID)
	expectStatus(t, res, 200)
	expectJSON(t, res, `{"success":true,"data":{"productIds":["`+product+`","`+other+`"]}}`)
	res, _ = f.do("GET", base+"/wishlist", nil, "X-Test-Member", member.CustomerID)
	expectJSON(t, res, `{"success":true,"data":{"productIds":["`+product+`","`+other+`"]}}`)
	res, _ = f.do("PUT", base+"/wishlist", map[string]any{"productIds": []string{other}}, "X-Test-Member", member.CustomerID)
	expectJSON(t, res, `{"success":true,"data":{"productIds":["`+other+`"]}}`)
	res, _ = f.do("PUT", base+"/wishlist", map[string]any{"productIds": []string{"kaos"}}, "X-Test-Member", member.CustomerID)
	expectStatus(t, res, 400)
	res, _ = f.do("PUT", base+"/wishlist", map[string]any{}, "X-Test-Member", member.CustomerID)
	expectStatus(t, res, 400)
}
