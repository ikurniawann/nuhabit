package posops_test

import (
	"strings"
	"testing"

	"nuhabit/backend/internal/platform/testutil"
)

var catalogMenus = map[string][]string{"pos.catalog.products": {"read", "create", "update", "delete"}}

func findProduct(t *testing.T, r response, id string) map[string]any {
	t.Helper()
	for _, p := range list(r.body["data"]) {
		if obj(p)["id"] == id {
			return obj(p)
		}
	}
	return nil
}

func TestProductsCatalog(t *testing.T) {
	h := newHarness(t, catalogMenus)
	sku := "GT-" + strings.ToUpper(testutil.RandomHex(4))

	r := h.anon("GET", "/api/pos/products", nil, 401)
	jsonEq(t, r.body, `{"success":false,"error":"Authentication required"}`)
	r = h.call("POST", "/api/pos/products", map[string]any{"sku": sku, "name": "x"}, 400)
	jsonEq(t, r.body, `{"success":false,"error":"SKU, name, and base_price are required"}`)
	r = h.call("POST", "/api/pos/products", map[string]any{"sku": sku, "name": "x", "base_price": 1, "product_kind": "toy"}, 400)
	jsonEq(t, r.body, `{"success":false,"error":"product_kind tidak valid (regular|gift_card|merchandise)"}`)
	r = h.call("POST", "/api/pos/products", "null", 500)
	jsonEq(t, r.body, `{"success":false,"error":"Cannot destructure property 'sku' of 'body' as it is null."}`)

	r = h.call("POST", "/api/pos/products", map[string]any{
		"sku": sku, "name": "Go Test Kopi " + sku, "base_price": 25000, "xp": 5, "station": " BAR ", "min_xp": "10.7",
		"variants":       []any{map[string]any{"name": "Large", "group_name": "Size", "price_adjustment": 5000}},
		"modifierGroups": []any{map[string]any{"name": "Sugar", "max_selection": 2, "modifiers": []any{map[string]any{"name": "Less"}}}},
	}, 200)
	p := data(r)
	id := p["id"].(string)
	if p["station"] != "bar" || p["xp"] != float64(5) || p["xp_points"] != float64(5) || p["base_price"] != "25000.00" ||
		p["cost_price"] != "0.00" || p["min_xp"] != float64(10) || p["product_kind"] != "regular" {
		t.Fatalf("created = %s", r.raw)
	}
	variant := obj(list(p["variants"])[0])
	if variant["name"] != "Large" || variant["price_adjustment"] != float64(5000) || variant["display_order"] != float64(0) {
		t.Fatalf("variant = %v", variant)
	}
	group := obj(obj(list(p["modifiers"])[0])["modifier_group"])
	if group["name"] != "Sugar" || group["max_selection"] != float64(2) || obj(list(group["modifiers"])[0])["name"] != "Less" {
		t.Fatalf("modifier group = %v", group)
	}
	keysInOrder(t, r.raw, "id", "sku", "bonus_xp", "variants", "modifiers", "xp")
	if strings.Contains(r.raw, `"category"`) || strings.Contains(r.raw, `"skus"`) {
		t.Fatalf("create embeds only variants and modifiers: %s", r.raw)
	}

	// PATCH: only the fields sent, web distribution to the shop channel.
	r = h.call("PATCH", "/api/pos/products/"+id, map[string]any{}, 400)
	jsonEq(t, r.body, `{"success":false,"error":"No product fields to update"}`)
	r = h.call("PATCH", "/api/pos/products/"+id, map[string]any{"sales_channels": []any{"pos", "tiktok"}}, 400)
	jsonEq(t, r.body, `{"success":false,"error":"Channel penjualan tidak valid"}`)
	r = h.call("PATCH", "/api/pos/products/"+id, map[string]any{"bonus_xp": 200000}, 400)
	jsonEq(t, r.body, `{"success":false,"error":"Bonus XP harus 0–100.000"}`)
	r = h.call("PATCH", "/api/pos/products/"+id, map[string]any{
		"xp_points": 7, "station": "dessert", "bonus_xp": "3.9", "sales_channels": []any{"pos", "gofood", "pos"},
		"web_distributed": true, "min_xp": "", "weight_gram": "-1",
	}, 200)
	p = data(r)
	if p["xp"] != float64(7) || p["station"] != "dessert" || p["bonus_xp"] != float64(3) || p["min_xp"] != nil ||
		p["weight_gram"] != nil || len(list(p["sales_channels"])) != 2 {
		t.Fatalf("patched = %s", r.raw)
	}

	r = h.call("GET", "/api/pos/products?search="+sku, nil, 200)
	got := findProduct(t, r, id)
	if got == nil {
		t.Fatalf("product missing: %s", r.raw)
	}
	jsonEq(t, got["channels"], `[{"channel_code":"web","is_distributed":true}]`)
	if got["category"] != nil || len(list(got["skus"])) != 0 || got["warehouse_id"] != nil || got["stall_name"] != nil {
		t.Fatalf("listed = %v", got)
	}
	jsonEq(t, r.body["meta"], `{"stall_scoped":false,"all_stalls":true,"warehouse_ids":[],"product_count":1,"active_mode":"unset"}`)
	keysInOrder(t, r.raw, "category", "variants", "skus", "channels", "modifiers", "xp", "warehouse_id", "warehouse_name",
		"stall_warehouse_id", "stall_code", "stall_name")

	// A GoFood-only product leaves the cashier list but not the product page.
	h.call("PATCH", "/api/pos/products/"+id, map[string]any{"sales_channels": []any{"gofood"}}, 200)
	r = h.call("GET", "/api/pos/products?search="+sku, nil, 200)
	if findProduct(t, r, id) != nil {
		t.Fatal("gofood-only product listed for the cashier")
	}
	r = h.call("GET", "/api/pos/products?include_inactive=true&search="+sku, nil, 200)
	if findProduct(t, r, id) == nil {
		t.Fatal("product page misses the gofood-only product")
	}

	// A user without the update action is refused.
	reader := newHarness(t, map[string][]string{"pos.catalog.products": {"read"}})
	r = reader.call("PATCH", "/api/pos/products/"+id, map[string]any{"xp": 1}, 403)
	jsonEq(t, r.body, `{"success":false,"error":"Insufficient permissions"}`)
}

func TestProductSkusAndMatrix(t *testing.T) {
	h := newHarness(t, catalogMenus)
	base := "gt-kaos-" + testutil.RandomHex(3)
	id := h.id(`INSERT INTO pos.pos_products (sku, name, base_price) VALUES ($1, 'Kaos Go', 100000) RETURNING id::text`, base)

	r := h.call("POST", "/api/pos/products/"+id+"/skus", map[string]any{"sku": "x", "name": "y"}, 400)
	jsonEq(t, r.body, `{"success":false,"error":"Varian SKU hanya untuk produk merchandise"}`)
	h.call("POST", "/api/pos/products/00000000-0000-4000-8000-000000000000/skus", map[string]any{"sku": "x", "name": "y"}, 404)
	h.exec(`UPDATE pos.pos_products SET product_kind = 'merchandise' WHERE id = $1`, id)

	r = h.call("POST", "/api/pos/products/"+id+"/skus", map[string]any{}, 400)
	jsonEq(t, r.body, `{"success":false,"error":"Kode SKU wajib diisi"}`)
	r = h.call("POST", "/api/pos/products/"+id+"/skus", map[string]any{"sku": " " + base + "-one ", "name": "One", "options": "x", "price_override": ""}, 201)
	one := data(r)
	if one["sku"] != base+"-one" || one["price_override"] != nil || string(mustJSON(one["options"])) != "{}" {
		t.Fatalf("sku = %s", r.raw)
	}
	r = h.call("POST", "/api/pos/products/"+id+"/skus", map[string]any{"sku": strings.ToUpper(base) + "-ONE", "name": "Dup"}, 409)
	jsonEq(t, r.body, `{"success":false,"error":"Kode SKU / barcode sudah dipakai varian lain"}`)

	r = h.call("PATCH", "/api/pos/products/"+id+"/skus/"+one["id"].(string), map[string]any{}, 400)
	jsonEq(t, r.body, `{"success":false,"error":"Tidak ada field yang diubah"}`)
	r = h.call("PATCH", "/api/pos/products/"+id+"/skus/"+one["id"].(string), map[string]any{"stock_quantity": "x"}, 400)
	jsonEq(t, r.body, `{"success":false,"error":"Stok varian harus angka"}`)
	r = h.call("PATCH", "/api/pos/products/"+id+"/skus/"+one["id"].(string), map[string]any{"stock_quantity": "5"}, 200)
	if data(r)["stock_quantity"] != "5.00" {
		t.Fatalf("patched sku = %s", r.raw)
	}
	r = h.call("GET", "/api/pos/products/"+id+"/skus", nil, 200)
	if len(list(r.body["data"])) != 1 {
		t.Fatalf("skus = %s", r.raw)
	}
	r = h.call("DELETE", "/api/pos/products/"+id+"/skus/"+one["id"].(string), nil, 200)
	jsonEq(t, r.body, `{"success":true}`)

	// Matrix: 2 sizes × 1 colour, then the same again (idempotent).
	axes := []any{
		map[string]any{"key": "ukuran", "values": []any{"S", " m ", "M"}},
		map[string]any{"key": "warna", "values": []any{"Hitám"}},
	}
	r = h.call("POST", "/api/pos/products/"+id+"/skus/matrix", map[string]any{"axes": "x"}, 400)
	jsonEq(t, r.body, `{"success":false,"error":"Sumbu varian harus berupa daftar"}`)
	r = h.call("POST", "/api/pos/products/"+id+"/skus/matrix", map[string]any{"axes": []any{}}, 400)
	jsonEq(t, r.body, `{"success":false,"error":"Sumbu varian (axes) wajib diisi, minimal satu sumbu dengan nilai"}`)
	r = h.call("POST", "/api/pos/products/"+id+"/skus/matrix", map[string]any{"axes": axes, "barcode_prefix": strings.Repeat("9", 21)}, 400)
	jsonEq(t, r.body, `{"success":false,"error":"Prefix barcode maksimal 20 karakter"}`)

	r = h.call("POST", "/api/pos/products/"+id+"/skus/matrix", map[string]any{"axes": axes, "barcode_prefix": "89", "price_override": "120000"}, 200)
	created := list(data(r)["created"])
	upper := strings.ToUpper(base)
	if len(created) != 2 || obj(created[0])["sku"] != upper+"-S-HITAM" || obj(created[1])["sku"] != upper+"-M-HITAM" ||
		obj(created[0])["name"] != "Kaos Go — S / Hitám" || obj(created[0])["barcode"] != "89"+upper+"-S-HITAM" ||
		obj(created[0])["price_override"] != "120000.00" {
		t.Fatalf("matrix = %s", r.raw)
	}
	jsonEq(t, obj(created[0])["options"], `{"warna":"Hitám","ukuran":"S"}`)
	keysInOrder(t, r.raw, "created", "reactivated", "deactivated", "kept", "skus")

	r = h.call("POST", "/api/pos/products/"+id+"/skus/matrix", map[string]any{"axes": axes}, 200)
	if len(list(data(r)["created"])) != 0 || len(list(data(r)["kept"])) != 2 || len(list(data(r)["skus"])) != 2 {
		t.Fatalf("idempotent = %s", r.raw)
	}
	if kept := obj(list(data(r)["kept"])[0]); kept["stock_quantity"] != float64(0) {
		t.Fatalf("kept stock is a number: %v", kept)
	}

	// Dropping M while it holds stock is refused; with no stock it is
	// deactivated, and asking for it again reactivates it.
	h.exec(`UPDATE pos.pos_product_skus SET stock_quantity = 3 WHERE product_id = $1 AND sku = $2`, id, upper+"-M-HITAM")
	onlyS := []any{map[string]any{"key": "ukuran", "values": []any{"S"}}, map[string]any{"key": "warna", "values": []any{"Hitám"}}}
	r = h.call("POST", "/api/pos/products/"+id+"/skus/matrix", map[string]any{"axes": onlyS}, 409)
	if r.body["error"] != "SKU dengan stok masih ada tidak bisa dinonaktifkan otomatis — kosongkan stoknya dulu" ||
		obj(list(r.body["blocked"])[0])["stock_quantity"] != float64(3) {
		t.Fatalf("blocked = %s", r.raw)
	}
	h.exec(`UPDATE pos.pos_product_skus SET stock_quantity = 0 WHERE product_id = $1`, id)
	r = h.call("POST", "/api/pos/products/"+id+"/skus/matrix", map[string]any{"axes": onlyS}, 200)
	if len(list(data(r)["deactivated"])) != 1 || obj(list(data(r)["deactivated"])[0])["is_active"] != false {
		t.Fatalf("deactivated = %s", r.raw)
	}
	r = h.call("POST", "/api/pos/products/"+id+"/skus/matrix", map[string]any{"axes": axes}, 200)
	reactivated := list(data(r)["reactivated"])
	if len(reactivated) != 1 || len(obj(reactivated[0])) != 4 || obj(reactivated[0])["sku"] != upper+"-M-HITAM" {
		t.Fatalf("reactivated = %s", r.raw)
	}
}

func TestSyncPurchasingProduct(t *testing.T) {
	h := newHarness(t, catalogMenus)
	var warehouse string
	if err := h.tx.QueryRow(h.ctx, `SELECT id::text FROM configuration.warehouses LIMIT 1`).Scan(&warehouse); err != nil {
		t.Skip("no warehouse to attach a purchasing product to")
	}
	kode := "GT" + strings.ToUpper(testutil.RandomHex(4))
	pid := h.id(`INSERT INTO item.products (kode, nama, kategori, harga_jual, warehouse_id) VALUES ($1, 'Es Kopi Go', 'Minuman Dingin', 20000, $2) RETURNING id::text`, kode, warehouse)

	r := h.call("POST", "/api/pos/products/sync-purchasing", map[string]any{}, 400)
	jsonEq(t, r.body, `{"success":false,"error":"purchasing_product_id is required"}`)

	r = h.call("POST", "/api/pos/products/sync-purchasing", map[string]any{"purchasing_product_id": pid}, 200)
	res := data(r)
	product := obj(res["product"])
	if res["mode"] != "created" || product["sku"] != "PUR-"+kode || product["station"] != "bar" || product["base_price"] != "20000.00" ||
		res["base_price"] != float64(20000) || res["gross_profit"] != float64(20000) || res["margin_percentage"] != float64(100) {
		t.Fatalf("sync = %s", r.raw)
	}
	keysInOrder(t, r.raw, "mode", "product", "cost_price", "base_price", "gross_profit", "margin_percentage")

	r = h.call("POST", "/api/pos/products/sync-purchasing", map[string]any{"purchasing_product_ids": []any{pid, pid}, "station": "bakery"}, 200)
	results := list(r.body["data"])
	if len(results) != 2 || obj(results[0])["mode"] != "updated" || obj(obj(results[1])["product"])["station"] != "bakery" {
		t.Fatalf("sync many = %s", r.raw)
	}

	// The product list carries the purchasing stall.
	r = h.call("GET", "/api/pos/products?include_inactive=true&search=Es%20Kopi%20Go", nil, 200)
	got := findProduct(t, r, product["id"].(string))
	if got == nil || got["warehouse_id"] != warehouse || got["stall_warehouse_id"] != warehouse || got["estimated_cogs"] != float64(0) {
		t.Fatalf("listed purchasing product = %v", got)
	}
}
