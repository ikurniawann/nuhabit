package posops_test

import (
	"strings"
	"testing"
)

var settingsMenus = map[string][]string{
	"pos.operations":       {"read", "update", "delete"},
	"pos.loyalty.settings": {"read", "update"},
	"settings.billing":     {"read", "update"},
	// The seeded pos.catalog.channel-prices menu is soft-deleted locally; a
	// child code passes the same prefix guard.
	"pos.catalog.channel-prices.gt": {"read", "update"},
}

func TestReceiptGiftCardAndStockAlerts(t *testing.T) {
	h := newHarness(t, settingsMenus)
	h.anon("GET", "/api/pos/receipt-settings", nil, 401)

	h.exec(`UPDATE pos.pos_receipt_settings SET is_active = false`)
	id := h.id(`INSERT INTO pos.pos_receipt_settings (header_lines, footer_lines) VALUES ($1::jsonb, '"x"') RETURNING id::text`,
		`[" Hai ", "", 5, "`+strings.Repeat("y", 50)+`"]`)
	r := h.call("GET", "/api/pos/receipt-settings", nil, 200)
	jsonEq(t, r.body["data"], `[{"id":"`+id+`","branch_id":null,"warehouse_id":null,"header_lines":["Hai","`+strings.Repeat("y", 42)+`"],
		"footer_lines":[],"show_stall_name":true,"updated_at":null}]`)

	h.exec(`INSERT INTO configuration.app_settings (key, value) VALUES ('giftcard_config', '{"presets":[100000,50000,50000,-1,"x"],"allow_custom":false,"expiry_months":6}')
		ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`)
	r = h.call("GET", "/api/pos/gift-card-config", nil, 200)
	jsonEq(t, r.body, `{"success":true,"data":{"presets":[50000,100000],"allow_custom":false}}`)
	h.exec(`UPDATE configuration.app_settings SET value = 'nope' WHERE key = 'giftcard_config'`)
	r = h.call("GET", "/api/pos/gift-card-config", nil, 200)
	jsonEq(t, r.body["data"], `{"presets":[50000,100000,200000,500000],"allow_custom":true}`)

	pid := h.id(`INSERT INTO pos.pos_products (sku, name, base_price, inventory_tracking, inventory_quantity, inventory_min_stock)
		VALUES ('GT-STK-' || substr(md5(random()::text), 1, 6), 'Stok GT', 1, true, 2, 5) RETURNING id::text`)
	r = h.call("GET", "/api/pos/stock-alerts", nil, 200)
	found := false
	for _, p := range list(data(r)["pos_products"]) {
		if obj(p)["id"] == pid {
			found = true
			if obj(p)["current"] != float64(2) || obj(p)["min"] != float64(5) || obj(p)["alert_level"] != "warning" {
				t.Fatalf("pos stock alert = %v", p)
			}
		}
	}
	if !found {
		t.Fatalf("stock alerts = %s", r.raw)
	}
	keysInOrder(t, r.raw, "raw_materials", "products_at_risk", "pos_products", "summary", "updated_at")
}

func TestLoyaltyAndPaymentMethods(t *testing.T) {
	h := newHarness(t, settingsMenus)

	r := h.call("PUT", "/api/pos/loyalty-settings", map[string]any{"ark_rate": 0}, 400)
	if r.body["error"] != "Invalid payload" || len(list(r.body["details"])) != 10 {
		t.Fatalf("invalid loyalty = %s", r.raw)
	}
	r = h.call("PUT", "/api/pos/loyalty-settings", map[string]any{
		"ark_rate": 2000, "topup_min_amount": 20000, "topup_presets": []any{100000, 50000.4, 100000},
		"topup_xp_enabled": true, "topup_xp_mode": "fixed", "topup_xp_value": 3, "topup_xp_amount_step": 10000,
		"spend_xp_enabled": false, "spend_xp_amount_step": 5000, "spend_xp_min": 0,
	}, 200)
	d := data(r)
	if d["ark_rate"] != float64(2000) || d["topup_xp_mode"] != "fixed" || d["spend_xp_enabled"] != false ||
		r.body["message"] != "Loyalty settings saved" || !strings.HasSuffix(d["updated_at"].(string), "GMT+0000 (Coordinated Universal Time)") {
		t.Fatalf("saved loyalty = %s", r.raw)
	}
	jsonEq(t, d["topup_presets"], `[50000,100000]`)
	r = h.call("GET", "/api/pos/loyalty-settings", nil, 200)
	if data(r)["id"] != "a0000000-0000-4000-8000-000000000001" || data(r)["ark_rate"] != float64(2000) {
		t.Fatalf("loyalty = %s", r.raw)
	}

	// Payment methods.
	r = h.call("POST", "/api/pos/payment-methods", map[string]any{"name": " Transfer GT ", "handler": "qris"}, 400)
	if r.body["error"] != "Validation failed" {
		t.Fatalf("bad handler = %s", r.raw)
	}
	r = h.call("POST", "/api/pos/payment-methods", map[string]any{"name": " Transfer GT ", "handler": "credit"}, 200)
	created := data(r)
	if created["code"] != "transfer_gt" || created["icon"] != "credit-card" || created["requires_cash_input"] != false ||
		created["description"] != "" || r.body["message"] != "Metode bayar ditambahkan" {
		t.Fatalf("created = %s", r.raw)
	}
	r = h.call("POST", "/api/pos/payment-methods", map[string]any{"name": "Transfer GT", "handler": "cash"}, 200)
	if data(r)["code"] != "transfer_gt_2" || data(r)["requires_cash_input"] != true {
		t.Fatalf("suffixed = %s", r.raw)
	}
	r = h.call("POST", "/api/pos/payment-methods", map[string]any{"name": "Cash", "handler": "cash"}, 200)
	if data(r)["code"] != "cash_2" {
		t.Fatalf("built-in clash = %s", r.raw)
	}

	r = h.call("PATCH", "/api/pos/payment-methods", map[string]any{"code": "transfer_gt"}, 400)
	jsonEq(t, r.body, `{"success":false,"error":"Tidak ada field yang diubah"}`)
	r = h.call("PATCH", "/api/pos/payment-methods", map[string]any{"code": "transfer_gt", "new_code": "cash"}, 400)
	jsonEq(t, r.body, `{"success":false,"error":"Kode itu dipakai metode bawaan"}`)
	r = h.call("PATCH", "/api/pos/payment-methods", map[string]any{"code": "transfer_gt", "new_code": "Transfer GT 2"}, 400)
	jsonEq(t, r.body, `{"success":false,"error":"Kode metode sudah dipakai"}`)
	r = h.call("PATCH", "/api/pos/payment-methods", map[string]any{"code": "cash", "new_code": "kas"}, 400)
	jsonEq(t, r.body, `{"success":false,"error":"Kode metode bawaan tidak bisa diubah"}`)
	r = h.call("PATCH", "/api/pos/payment-methods", map[string]any{"code": "nope_gt", "is_active": false}, 404)
	jsonEq(t, r.body, `{"success":false,"error":"Metode bayar tidak ditemukan"}`)
	r = h.call("PATCH", "/api/pos/payment-methods", map[string]any{"code": "transfer_gt", "name": "BCA GT", "sort_order": 0, "new_code": "bca-gt"}, 200)
	if data(r)["code"] != "bca_gt" || data(r)["name"] != "BCA GT" || data(r)["sort_order"] != float64(100) {
		t.Fatalf("patched = %s", r.raw)
	}
	r = h.call("PATCH", "/api/pos/payment-methods", nil, 500)
	jsonEq(t, r.body, `{"success":false,"error":"Gagal memperbarui metode bayar"}`)

	r = h.call("DELETE", "/api/pos/payment-methods?code=cash", nil, 400)
	jsonEq(t, r.body, `{"success":false,"error":"Metode bawaan tidak bisa dihapus — nonaktifkan saja"}`)
	r = h.call("DELETE", "/api/pos/payment-methods?code=bca_gt", nil, 200)
	jsonEq(t, r.body, `{"success":true,"data":{"code":"bca_gt"},"message":"Metode bayar dihapus"}`)
	h.call("DELETE", "/api/pos/payment-methods?code=bca_gt", nil, 404)

	h.exec(`UPDATE crm.crm_settings SET value = 'false'::jsonb WHERE key = 'ark_coin_enabled'`)
	r = h.call("GET", "/api/pos/payment-methods?active=1", nil, 200)
	for _, m := range list(r.body["data"]) {
		if obj(m)["code"] == "ark_coin" {
			t.Fatal("ark_coin offered while disabled")
		}
	}
	r = h.call("GET", "/api/pos/payment-methods", nil, 200)
	keysInOrder(t, r.raw, "id", "code", "name", "description", "icon", "handler", "is_active", "sort_order", "requires_cash_input")
}

func TestChannelsAndBilling(t *testing.T) {
	h := newHarness(t, settingsMenus)

	r := h.call("PUT", "/api/pos/sales-channels/nope", map[string]any{}, 404)
	jsonEq(t, r.body, `{"success":false,"error":"Channel tidak dikenal"}`)
	r = h.call("PUT", "/api/pos/sales-channels/gofood", map[string]any{"markup_percent": 10, "rounding_step": 250, "rounding_mode": "up", "is_active": true}, 400)
	jsonEq(t, r.body, `{"success":false,"error":"Aturan harga tidak valid"}`)
	r = h.call("PUT", "/api/pos/sales-channels/gofood", map[string]any{"markup_percent": 10.555, "rounding_step": 500, "rounding_mode": "nearest", "is_active": true}, 200)
	jsonEq(t, r.body["data"], `{"code":"gofood","name":"GoFood","markupPercent":10.56,"roundingStep":500,"roundingMode":"nearest","isActive":true}`)

	pid := h.id(`INSERT INTO pos.pos_products (sku, name, base_price) VALUES ('GT-CH-' || substr(md5(random()::text), 1, 6), 'Channel GT', 12500) RETURNING id::text`)
	r = h.call("PUT", "/api/pos/channel-prices", map[string]any{"channel": "gofood", "prices": []any{map[string]any{"product_id": pid, "price": 1.5}}}, 400)
	jsonEq(t, r.body, `{"success":false,"error":"Data harga tidak valid (harga harus bilangan bulat > 0)"}`)
	r = h.call("PUT", "/api/pos/channel-prices", map[string]any{"channel": "gofood", "prices": []any{
		map[string]any{"product_id": pid, "price": 15000},
		map[string]any{"product_id": "00000000-0000-4000-8000-000000000009", "price": 1},
	}}, 200)
	jsonEq(t, r.body, `{"success":true,"data":{"saved":1,"cleared":0}}`)
	r = h.call("GET", "/api/pos/channel-prices?channel=gofood", nil, 200)
	if obj(data(r)["channel"])["code"] != "gofood" {
		t.Fatalf("channel = %s", r.raw)
	}
	for _, p := range list(data(r)["products"]) {
		if obj(p)["id"] == pid && (obj(p)["override_price"] != float64(15000) || obj(p)["base_price"] != float64(12500)) {
			t.Fatalf("product = %v", p)
		}
	}
	r = h.call("PUT", "/api/pos/channel-prices", map[string]any{"channel": "gofood", "prices": []any{map[string]any{"product_id": pid, "price": nil}}}, 200)
	jsonEq(t, r.body["data"], `{"saved":0,"cleared":1}`)

	// Billing: replace the system scope profile, then preview a bill.
	r = h.call("PUT", "/api/pos/billing-settings", map[string]any{"name": "x"}, 400)
	if r.body["error"] != "Invalid payload" {
		t.Fatalf("invalid billing = %s", r.raw)
	}
	charge := func(code, kind, method string, rate float64, order int, optional bool) map[string]any {
		return map[string]any{"code": code, "name": code, "charge_kind": kind, "calc_method": method, "rate": rate, "amount": 0,
			"apply_order": order, "is_enabled": true, "is_optional": optional, "base": "subtotal_after_discount"}
	}
	r = h.call("PUT", "/api/pos/billing-settings", map[string]any{"branch_id": nil, "warehouse_id": nil, "name": "GT",
		"charges": []any{charge("tax", "tax", "percent", 10, 200, true), charge("TAX", "tax", "percent", 5, 1, false)}}, 400)
	jsonEq(t, r.body, `{"success":false,"error":"Charge codes must be unique within a profile"}`)
	r = h.call("PUT", "/api/pos/billing-settings", map[string]any{"branch_id": nil, "warehouse_id": nil, "name": " GT ",
		"charges": []any{charge("tax", "tax", "percent", 10, 200, true), charge("SVC", "service", "percent", 5, 100, false),
			charge("RND", "rounding", "round_up", 1000, 900, false)}}, 200)
	profile := data(r)
	if profile["name"] != "GT" || profile["scope"] != "system" || len(list(profile["charges"])) != 3 ||
		obj(list(profile["charges"])[0])["code"] != "SVC" {
		t.Fatalf("billing = %s", r.raw)
	}
	h.exec(`UPDATE pos.pos_billing_profiles SET is_active = false WHERE id = 'b0000000-0000-4000-8000-000000000001'`)
	r = h.call("GET", "/api/pos/billing-settings?subtotal=100300&enabled_codes=tax", nil, 200)
	if obj(data(r)["profile"])["id"] != profile["id"] {
		t.Fatalf("resolved = %s", r.raw)
	}
	jsonEq(t, obj(data(r))["preview"], `{"tax_amount":10030,"service_charge_amount":5015,"other_charges_amount":655,"rounding_adjustment":655,"total":116000,
		"breakdown":[{"code":"SVC","name":"SVC","kind":"service","amount":5015,"rate":5,"calc_method":"percent"},
		{"code":"TAX","name":"tax","kind":"tax","amount":10030,"rate":10,"calc_method":"percent"},
		{"code":"RND","name":"RND","kind":"rounding","amount":655,"calc_method":"round_up"}]}`)
	r = h.call("GET", "/api/pos/billing-settings?mode=list", nil, 200)
	if len(list(r.body["data"])) == 0 {
		t.Fatalf("list = %s", r.raw)
	}
	r = h.call("GET", "/api/pos/billing-settings?mode=options", nil, 200)
	keysInOrder(t, r.raw, "branches", "warehouses", "profiles")
	r = h.call("GET", "/api/pos/billing-settings?branch_id=bad", nil, 400)
	jsonEq(t, r.body, `{"success":false,"error":"Format data tidak valid"}`)
}
