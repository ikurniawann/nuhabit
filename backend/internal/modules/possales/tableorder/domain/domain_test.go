package domain

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"
)

// Ports of lib/table-order/{menu,pricing,guest,order-status}.test.ts for the
// rules the routes use. Client-only helpers (cart, filters, sections, stored
// guest, progress steps, incoming, my-orders) stay in TS.

func f(v float64) *float64 { return &v }
func s(v string) *string   { return &v }

func baseRow() ProductRow {
	return ProductRow{
		ID: "p1", SKU: s("KOPI-01"), Name: "Kopi Susu Gula Aren",
		Description: s("  Espresso, susu, gula aren.  "), BasePrice: f(28000), ImageURL: s(""),
		XPPoints: f(28), Station: s("BAR"), PrepTimeMinutes: f(5),
		CategoryID: s("c-drink"), CategoryName: s("Minuman"),
		Variants: []byte(`[{"id":"v-ice","name":"Ice","price_adjustment":"0"},{"id":"v-hot","name":"Hot","price_adjustment":0},{"id":"v-off","name":"Nonaktif","price_adjustment":5000,"is_active":false}]`),
	}
}

func TestNormalizeProduct(t *testing.T) {
	p := NormalizeProduct(baseRow())
	if p.Price != 28000 || p.XP != 28 || p.Station != "bar" || p.StationLabel != "Bar" || p.Image != nil ||
		p.Description != "Espresso, susu, gula aren." || !p.Customizable || p.MinXP != 0 {
		t.Fatalf("normalized: %+v", p)
	}
	if ids := []string{p.Variants[0].ID, p.Variants[1].ID}; len(p.Variants) != 2 || ids[0] != "v-ice" || ids[1] != "v-hot" {
		t.Fatalf("variants: %+v", p.Variants)
	}

	row := baseRow()
	row.CategoryID, row.CategoryName = nil, nil
	row.Variants = []byte(`[{"id":"v1","name":"Regular","price_adjustment":0}]`)
	p = NormalizeProduct(row)
	if p.CategoryName != UncategorizedLabel || len(p.Variants) != 1 || p.Customizable {
		t.Fatalf("uncategorized: %+v", p)
	}

	row = baseRow()
	row.Variants = []byte(`{bukan json`)
	if p = NormalizeProduct(row); len(p.Variants) != 0 {
		t.Fatalf("broken variants: %+v", p.Variants)
	}

	row = baseRow()
	row.BasePrice, row.XPPoints = nil, f(-3)
	if p = NormalizeProduct(row); p.Price != 0 || p.XP != 0 {
		t.Fatalf("negative: %+v", p)
	}
	if b, _ := json.Marshal(p); !strings.HasPrefix(string(b), `{"id":"p1","sku":"KOPI-01","name":"Kopi Susu Gula Aren","description":"Espresso, susu, gula aren.","price":0,"xp":0,"station":"bar","stationLabel":"Bar","image":null,"categoryId":"c-drink"`) {
		t.Fatalf("json order: %s", b)
	}
}

func TestResolveVariantAndUnitPrice(t *testing.T) {
	row := baseRow()
	row.Variants = []byte(`[{"id":"reg","name":"Regular","price_adjustment":0},{"id":"lg","name":"Large","price_adjustment":6000}]`)
	p := NormalizeProduct(row)
	if ResolveVariant(p, "").ID != "reg" || ResolveVariant(p, "lg").ID != "lg" || ResolveVariant(p, "palsu") != nil {
		t.Fatal("resolveVariant")
	}
	plain := baseRow()
	plain.Variants = []byte(`[]`)
	pp := NormalizeProduct(plain)
	if ResolveVariant(pp, "apa-saja") != nil || UnitPrice(pp, nil, nil) != 28000 {
		t.Fatal("no variants")
	}
	if UnitPrice(p, ResolveVariant(p, "lg"), nil) != 34000 {
		t.Fatal("variant price")
	}
	if UnitPrice(Product{Price: 10000.4}, &Variant{PriceAdjustment: 0.4}, nil) != 10001 {
		t.Fatal("rounding")
	}
}

func TestBuildCategories(t *testing.T) {
	mk := func(id string, cat *string, name *string) Product {
		r := baseRow()
		r.ID, r.CategoryID, r.CategoryName = id, cat, name
		return NormalizeProduct(r)
	}
	got := BuildCategories([]Product{
		mk("a", s("c-drink"), s("Minuman")), mk("b", s("c-food"), s("Makanan")),
		mk("c", nil, nil), mk("d", s("c-drink"), s("Minuman")),
	})
	want := []Category{{"c-drink", "Minuman", 2}, {"c-food", "Makanan", 1}, {UncategorizedID, UncategorizedLabel, 1}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %+v", got)
	}
}

func TestModifiers(t *testing.T) {
	p := NormalizeProduct(ProductRow{ID: "p1", Name: "Iced Latte", BasePrice: f(25000), ModifierGroups: []byte(`[
		{"id":"g1","name":"Tambahan Espresso","min_selection":0,"max_selection":1,
		 "modifiers":[{"id":"m1","name":"Extra Shot Espresso","price_adjustment":10000},{"id":"m2","name":"Double","price_adjustment":"18000"}]},
		{"id":"g2","name":"Suhu","min_selection":1,"max_selection":null,"modifiers":[{"id":"hot","name":"Hot"},{"id":"ice","name":"Iced"}]},
		{"id":"g3","name":"Kosong","modifiers":[]}]`)})
	if len(p.ModifierGroups) != 2 || p.ModifierGroups[1].MinSelection != 1 || p.ModifierGroups[1].MaxSelection != 1 ||
		p.ModifierGroups[0].Modifiers[1].PriceAdjustment != 18000 || !p.Customizable {
		t.Fatalf("groups: %+v", p.ModifierGroups)
	}

	sel, msg := ResolveModifiers(p, []string{"m1", "ice"})
	if msg != "" || len(sel) != 2 || sel[0].GroupName != "Tambahan Espresso" || sel[1].Name != "Iced" || UnitPrice(p, nil, sel) != 35000 {
		t.Fatalf("valid: %v %+v", msg, sel)
	}
	for ids, want := range map[string]string{
		"x,hot":     "Tambahan Iced Latte tidak dikenal — pilih ulang",
		"hot,hot":   "Tambahan Iced Latte dipilih ganda — pilih ulang",
		"m1,m2,hot": "Tambahan Espresso: maksimal 1 pilihan",
		"m1":        "Suhu: wajib pilih 1",
	} {
		if _, msg := ResolveModifiers(p, strings.Split(ids, ",")); msg != want {
			t.Errorf("%s: %q", ids, msg)
		}
	}
	if sel, msg := ResolveModifiers(Product{Name: "Lama"}, nil); msg != "" || len(sel) != 0 {
		t.Fatal("no groups")
	}
}

func percent(code, kind string, rate, order float64) Charge {
	return Charge{Code: code, Name: code, ChargeKind: kind, CalcMethod: "percent", Rate: rate, ApplyOrder: order, IsEnabled: true, Base: "subtotal_after_discount"}
}

func TestCalculateBill(t *testing.T) {
	if b := CalculateBill(101000, nil); b.Total != 101000 || b.TaxAmount != 0 || len(b.Breakdown) != 0 {
		t.Fatalf("no charges: %+v", b)
	}
	b := CalculateBill(100000, []Charge{percent("TAX", "tax", 10, 200), percent("SERVICE", "service", 5, 100)})
	if b.ServiceChargeAmount != 5000 || b.TaxAmount != 10000 || b.Total != 115000 || b.Breakdown[0].Code != "SERVICE" || b.Breakdown[1].Code != "TAX" {
		t.Fatalf("service then tax: %+v", b)
	}
	off := percent("TAX", "tax", 10, 200)
	off.IsEnabled = false
	if b := CalculateBill(25000, []Charge{off}); b.Total != 25000 {
		t.Fatal("disabled charge")
	}
	optional := percent("TAX", "tax", 10, 200)
	optional.IsOptional = true
	if b := CalculateBill(25000, []Charge{optional}); b.Total != 25000 {
		t.Fatal("optional charge without toggles")
	}
	round := Charge{Code: "ROUND", Name: "Rounding", ChargeKind: "rounding", CalcMethod: "round_nearest", Rate: 500, ApplyOrder: 900, IsEnabled: true}
	b = CalculateBill(10000, []Charge{percent("TAX", "tax", 11, 200), round})
	if b.Total != 11000 || b.RoundingAdjustment != -100 || b.OtherChargesAmount != -100 {
		t.Fatalf("rounding: %+v", b)
	}
	raw, _ := json.Marshal(b.Breakdown)
	if string(raw) != `[{"code":"TAX","name":"TAX","kind":"tax","amount":1100,"rate":11,"calc_method":"percent"},{"code":"ROUND","name":"Rounding","kind":"rounding","amount":-100,"calc_method":"round_nearest"}]` {
		t.Fatalf("breakdown json: %s", raw)
	}
}

func TestMemberDiscountAndTier(t *testing.T) {
	for _, c := range []struct{ amount, pct, want float64 }{
		{28000, 10, 2800}, {28500, 10, 2850}, {10005, 10, 1000}, {28000, 0, 0}, {28000, -5, 0}, {28000, 150, 28000}, {-100, 10, 0},
	} {
		if got := MemberDiscountAmount(c.amount, c.pct); got != c.want {
			t.Errorf("MemberDiscountAmount(%v,%v)=%v", c.amount, c.pct, got)
		}
	}
	// 60.000 − 10% = 54.000 ; PB1 10% = 5.400 → 59.400
	d := MemberDiscountAmount(60000, 10)
	if b := CalculateBill(60000-d, []Charge{percent("TAX", "tax", 10, 200)}); d != 6000 || b.TaxAmount != 5400 || b.Total != 59400 {
		t.Fatalf("discount before tax: %v %+v", d, b)
	}
	tiers := []Tier{{0, 0}, {100, 0}, {10000, 5}}
	for xp, want := range map[float64]float64{0: 0, 150: 0, 10000: 5, 50000: 5} {
		if got := TierDiscountPercent(tiers, xp); got != want {
			t.Errorf("tier(%v)=%v", xp, got)
		}
	}
	if TierDiscountPercent([]Tier{{100, 7}}, 0) != 7 || TierDiscountPercent(nil, 10) != 0 || TierDiscountPercent([]Tier{{0, 250}}, 1) != 100 {
		t.Fatal("tier edges")
	}
}

func TestGuest(t *testing.T) {
	for in, want := range map[string]string{
		"0812-3456-7890": "6281234567890", "+62 812 3456 7890": "6281234567890", "81234567890": "6281234567890",
		"0212345678": "", "0812": "", "": "",
	} {
		if got := NormalizeGuestPhone(in); got != want {
			t.Errorf("phone %q → %q", in, got)
		}
	}
	if g, msg := ValidateGuest("  Budi   Santoso ", "08123456789"); msg != "" || g != (Guest{"Budi Santoso", "628123456789"}) {
		t.Fatalf("valid guest: %+v %q", g, msg)
	}
	if _, msg := ValidateGuest("Budi", "123"); !strings.Contains(msg, "WhatsApp") {
		t.Fatal(msg)
	}
	if _, msg := ValidateGuest("B", "08123456789"); !strings.Contains(msg, "nama") {
		t.Fatal(msg)
	}
}

func TestPaymentFlowAndLabels(t *testing.T) {
	cases := []struct {
		sr, pm *string
		want   string
	}{
		{s("Self-service table order WIT-BDG; payment=static_qris"), nil, "static_qris"},
		{s("Self-service table order T1; payment=QRIS"), s("cash"), "qris"},
		{nil, s("cash"), "cash"},
		{nil, nil, "cashier"},
	}
	for _, c := range cases {
		if got := PaymentFlowFrom(c.sr, c.pm); got != c.want {
			t.Errorf("flow %v → %q", c.sr, got)
		}
	}
	for in, want := range map[string]string{"ark_coin": "ARK Coin", "": "—", "static_qris": "Static QRIS", "cashier": "Bayar di kasir", "va": "va"} {
		if got := PaymentMethodText(in); got != want {
			t.Errorf("label %q → %q", in, got)
		}
	}
}

func TestLoyaltyFlagAndQRPaid(t *testing.T) {
	for v, want := range map[any]bool{true: true, false: false, "false": false, "0": false, 0.0: false, 1.0: true, "yes": true, nil: true} {
		if LoyaltyFlag(v) != want {
			t.Errorf("flag %v", v)
		}
	}
	if !IsXenditQRPaid(map[string]any{"status": "succeeded"}) || !IsXenditQRPaid(map[string]any{"payments": []any{map[string]any{"status": "COMPLETED"}}}) ||
		IsXenditQRPaid(map[string]any{"status": "ACTIVE", "data": []any{map[string]any{"status": "PENDING"}}}) {
		t.Fatal("qr paid")
	}
}

func TestOrderAlertMessage(t *testing.T) {
	msg := BuildOrderAlertMessage(OrderAlert{
		BrandName: "BCD Coffee", SourceLabel: "Self-order QR", TableLabel: "WIT. Office Bandung", OrderType: "dine_in",
		QueueNumber: "007", OrderNumber: "ORD-1", PaymentLabel: "Bayar di kasir", GuestName: "Budi", GuestPhone: "6281234567890",
		CustomerNote: "less ice", Total: 121000, ActionURL: "https://app.test/dashboard/pos/self-orders?order=o1",
		Items: []AlertItem{{Name: "Iced Latte", Quantity: 2, Variant: "Regular", Modifiers: []string{"Extra Shot Espresso"}}},
	})
	want := "🛎️ Pesanan baru — Self-order QR\nBCD Coffee\nMeja WIT. Office Bandung · Makan di tempat\nAntrean 007 · ORD-1\n" +
		"Atas nama: Budi · WA 081234567890\n\n• 2× Iced Latte (Regular, Extra Shot Espresso)\n\nCatatan: less ice\n\n" +
		"Total Rp121.000 · Bayar di kasir (belum dibayar)\n\n👉 Buatkan Pesanan: https://app.test/dashboard/pos/self-orders?order=o1"
	if msg != want {
		t.Fatalf("message:\n%s", msg)
	}
	cfg := ParseAlertConfig(`{"waEnabled":false,"waRoles":["pos_supervisor","admin"]}`)
	if cfg.WAEnabled || !cfg.TelegramEnabled || !reflect.DeepEqual(cfg.WARoles, []string{"pos_supervisor"}) {
		t.Fatalf("config: %+v", cfg)
	}
	if c := ParseAlertConfig("{rusak"); !c.WAEnabled || c.WARoles[0] != "pos" {
		t.Fatal("default config")
	}
	if NormalizeWAPhone("0812-3456-789") != "628123456789" || NormalizeWAPhone("0812") != "" {
		t.Fatal("wa phone")
	}
}
