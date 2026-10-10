package domain

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"
)

// Ported from lib/shop/orders.test.ts.
func TestOrderTransitions(t *testing.T) {
	for next, want := range map[string][]string{
		"packing": {"paid"}, "completed": {"shipped"}, "cancelled": {"pending", "paid", "packing", "ready_for_pickup"},
		"ready_for_pickup": {"paid"}, "picked_up": {"ready_for_pickup"},
	} {
		got, ok := AllowedFromStatuses(next)
		if !ok || !reflect.DeepEqual(got, want) {
			t.Errorf("AllowedFromStatuses(%q) = %v %v", next, got, ok)
		}
	}
	for _, next := range []string{"shipped", "toString", ""} {
		if _, ok := AllowedFromStatuses(next); ok {
			t.Errorf("AllowedFromStatuses(%q) should be unknown", next)
		}
	}
	for status, want := range map[string]bool{"paid": true, "packing": true, "pending": false, "shipped": false} {
		if CanShipOrder(status) != want {
			t.Errorf("CanShipOrder(%q) != %v", status, want)
		}
	}
	for _, c := range []struct {
		next, method string
		want         bool
	}{
		{"packing", DeliveryShip, true}, {"packing", DeliveryPickup, false},
		{"ready_for_pickup", DeliveryPickup, true}, {"ready_for_pickup", DeliveryShip, false},
		{"picked_up", DeliveryShip, false}, {"cancelled", DeliveryPickup, true},
	} {
		if TransitionFitsDelivery(c.next, c.method) != c.want {
			t.Errorf("TransitionFitsDelivery(%q, %q) != %v", c.next, c.method, c.want)
		}
	}
}

func TestCheckoutRules(t *testing.T) {
	if OrderTotal(100000, 150000, 12000) != 0 || OrderTotal(100000, 10000, 12000) != 102000 {
		t.Error("OrderTotal")
	}
	threshold, zero := 100000.0, 0.0
	if ShippingCost(12000, 100000, &threshold) != 0 || ShippingCost(12000, 99999, &threshold) != 12000 ||
		ShippingCost(12000, 100000, nil) != 12000 || ShippingCost(12000, 100000, &zero) != 12000 {
		t.Error("ShippingCost")
	}
	if PromoMessage("kuota-habis") != "This promo code has been fully used" || PromoMessage("??") != PromoMessage("nonaktif") {
		t.Error("PromoMessage")
	}
	number := "0812-3456-789"
	if got := WhatsAppLink(&number, "SHOP-1"); got == nil || *got != "https://wa.me/628123456789?text=Hi%2C+I+have+a+question+about+order+SHOP-1" {
		t.Errorf("WhatsAppLink = %v", got)
	}
	short := "123"
	if WhatsAppLink(nil, "x") != nil || WhatsAppLink(&short, "x") != nil {
		t.Error("WhatsAppLink without a usable number")
	}
	if strings.Count(OrderPlacedMessage("https://a", "SHOP-1", "Budi", "tok", "Pick up at Dago", "https://pay", 5000), "https://") != 2 {
		t.Error("OrderPlacedMessage links")
	}
}

func TestParseOrderListFilter(t *testing.T) {
	got := ParseOrderListFilter(" paid ", " budi", "", false)
	if got != (OrderListFilter{Status: "paid", Search: "budi", Limit: 100}) {
		t.Errorf("filter = %+v", got)
	}
	if ParseOrderListFilter("", "", "999", true).Limit != 200 {
		t.Error("limit caps at 200")
	}
	if ParseOrderListFilter("", "", "-5", true).Limit != 1 {
		t.Error("limit floors at 1")
	}
	if ParseOrderListFilter("", "", "abc", true).Limit != 100 {
		t.Error("NaN limit falls back to 100")
	}
}

// Ported from lib/shop/order-status.test.ts.
func TestPublicOrderItem(t *testing.T) {
	l := "L"
	item := PublicItem(OrderItemRow{ProductName: "Kaos", SkuName: &l, Quantity: "2", UnitPrice: "50000", Total: "100000"})
	if item != (PublicOrderItem{Name: "Kaos — L", Quantity: 2, UnitPrice: 50000, Total: 100000}) {
		t.Errorf("item = %+v", item)
	}
	jne, reg := "jne", "reg"
	if got := JoinNonEmpty(" — ", &jne, &reg); got != "jne — reg" {
		t.Errorf("courier = %q", got)
	}
	url := "https://invoice.example/abc"
	if InvoiceURLWhilePending("pending", &url) != &url || InvoiceURLWhilePending("paid", &url) != nil {
		t.Error("invoice link only while pending")
	}
}

// Ported from lib/shop/shipping/quotes.test.ts.
func TestQuotes(t *testing.T) {
	q := func(courier, service string, price float64) RateQuote {
		return RateQuote{Provider: "biteship", CourierCode: courier, ServiceCode: service, Price: price}
	}
	priced := WithMarkup([]RateQuote{q("jne", "reg", 10_000), q("jnt", "ez", 0)}, 2_500)
	if len(priced) != 1 || priced[0].CourierCode != "jne" || priced[0].Price != 10_000 || priced[0].TotalPrice != 12_500 {
		t.Errorf("priced = %+v", priced)
	}
	quotes := []RateQuote{q("JNE", "REG", 10_000), q("sicepat", "best", 0)}
	if got, ok := FindQuote(quotes, "jne", "reg"); !ok || got.Price != 10_000 {
		t.Error("case-insensitive match")
	}
	if _, ok := FindQuote(quotes, "sicepat", "best"); ok {
		t.Error("zero price is unavailable")
	}
	if _, ok := FindQuote(quotes, "jne", "yes"); ok {
		t.Error("unknown service")
	}
}

func body(t *testing.T, raw string) map[string]any {
	t.Helper()
	var m map[string]any
	dec := json.NewDecoder(strings.NewReader(raw))
	dec.UseNumber()
	if err := dec.Decode(&m); err != nil {
		t.Fatal(err)
	}
	return m
}

// Ported from lib/shop/shipping/settings.test.ts.
func TestBuildShippingSettingsPatch(t *testing.T) {
	fields, msg := BuildShippingSettingsPatch(body(t, `{"provider":"RajaOngkir","origin_label":"","origin_postal_code":40115,"couriers":" JNE, sicepat ,,","markup_amount":"2000"}`))
	want := []PatchField{
		{"provider", "rajaongkir"}, {"origin_label", nil}, {"origin_postal_code", "40115"},
		{"couriers", "jne,sicepat"}, {"markup_amount", 2000.0},
	}
	if msg != "" || !reflect.DeepEqual(fields, want) {
		t.Errorf("patch = %v %q", fields, msg)
	}
	for raw, wantMsg := range map[string]string{
		`{"provider":"jne"}`:      "Provider harus biteship atau rajaongkir",
		`{"couriers":","}`:        "Minimal satu kurir harus aktif",
		`{"markup_amount":-1}`:    "Markup harus angka ≥ 0",
		`{}`:                      "Tidak ada field yang diubah",
		`{"markup_amount":"abc"}`: "Markup harus angka ≥ 0",
	} {
		if _, msg := BuildShippingSettingsPatch(body(t, raw)); msg != wantMsg {
			t.Errorf("%s: msg = %q", raw, msg)
		}
	}
	fields, _ = BuildShippingSettingsPatch(body(t, `{"couriers":""}`))
	if !reflect.DeepEqual(fields, []PatchField{{"couriers", "jne,jnt,sicepat"}}) {
		t.Errorf("empty couriers = %v", fields)
	}
}

func TestSafeEqual(t *testing.T) {
	if !SafeEqual("bs-secret", "bs-secret") || SafeEqual("bs-secre", "bs-secret") || SafeEqual("", "") {
		t.Error("SafeEqual")
	}
}
