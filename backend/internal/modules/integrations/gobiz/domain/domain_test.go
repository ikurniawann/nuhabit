package domain

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"reflect"
	"regexp"
	"strings"
	"testing"
)

func eq(t *testing.T, got, want any) {
	t.Helper()
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got  %#v\nwant %#v", got, want)
	}
}

func jsonEq(t *testing.T, got any, want string) {
	t.Helper()
	raw, err := json.Marshal(got)
	if err != nil {
		t.Fatal(err)
	}
	var a, b any
	_ = json.Unmarshal(raw, &a)
	if err := json.Unmarshal([]byte(want), &b); err != nil {
		t.Fatalf("bad want: %v", err)
	}
	if !reflect.DeepEqual(a, b) {
		t.Fatalf("got  %s\nwant %s", raw, want)
	}
}

func ptr[T any](v T) *T { return &v }

/* ── config.ts ───────────────────────────────────────────────────────── */

func TestWebhookURL(t *testing.T) {
	eq(t, WebhookURL("https://pos.test/", "tok"), "https://pos.test/api/integrations/gobiz/webhook/tok")
}

func TestSafeEqual(t *testing.T) {
	eq(t, SafeEqual("secret-token", "secret-token"), true)
	eq(t, SafeEqual("secret-token", "wrong"), false)
	eq(t, SafeEqual("", ""), false)
	eq(t, SafeEqual("x", ""), false)
}

/* ── signature.test.ts ───────────────────────────────────────────────── */

func TestVerifySignature(t *testing.T) {
	body := `{"header":{"event_id":"e1"}}`
	secret := "96a0-test-secret"
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(body))
	good := hex.EncodeToString(mac.Sum(nil))

	eq(t, ComputeSignature(body, secret), good)
	eq(t, VerifySignature(body, good, secret), SignatureValid)
	eq(t, VerifySignature(body, strings.ToUpper(good), secret), SignatureValid)
	eq(t, VerifySignature(strings.Replace(body, "e1", "e2", 1), good, secret), SignatureInvalid)
	eq(t, VerifySignature(body, "abc", secret), SignatureInvalid)
	eq(t, VerifySignature(body, "", secret), SignatureMissing)
	eq(t, VerifySignature(body, good, ""), SignatureUnconfigured)
}

/* ── mapping.test.ts ─────────────────────────────────────────────────── */

const sampleEvent = `{
  "header": {"event_name": "gofood.order.awaiting_merchant_acceptance", "event_id": "c1be7fa1-645e-3d57-9ca3-f2cb54212345",
             "version": 1, "timestamp": "2019-08-24T14:15:22.557+07:00"},
  "body": {
    "customer": {"id": "536D5047", "name": "GoFood Customer"},
    "driver": {"name": "GoFood Driver"},
    "service_type": "gofood",
    "outlet": {"id": "G123456789", "external_outlet_id": "outlet01"},
    "order": {
      "status": "AWAITING_MERCHANT_ACCEPTANCE", "pin": "1234", "order_number": "F-123456789",
      "order_total": 40000, "currency": "IDR",
      "order_items": [
        {"id": "e44495da", "external_id": "prod-1", "name": "Hamburger", "quantity": 2, "price": 15000, "notes": "pedas",
         "variants": [{"id": "var-x", "name": "Hamburger keju", "external_id": "v-keju"}]},
        {"id": "zz", "external_id": "prod-unknown", "name": "Misterius", "quantity": 1, "price": 10000},
        {"id": "yy", "name": "Tanpa id", "quantity": 1, "price": 0}
      ],
      "cutlery_requested": true, "takeaway_charges": 0, "created_at": "2019-08-24T14:15:22.557+07:00",
      "cancellation_detail": {"reason": ""}
    }
  }
}`

func TestParseWebhook(t *testing.T) {
	ev := ParseWebhook(sampleEvent)
	if ev == nil || ev.Header.EventID != "c1be7fa1-645e-3d57-9ca3-f2cb54212345" {
		t.Fatalf("sample rejected: %#v", ev)
	}
	for _, bad := range []string{`{"foo":1}`, `null`, `{"header":{"event_name":"x"}}`, ``, `not json`, `[1]`,
		`{"header":{"event_name":"x","event_id":""}}`,
		`{"header":{"event_name":"x","event_id":"e","version":"1"}}`,
		`{"header":{"event_name":"x","event_id":"e"},"body":{"order":{"pin":1234}}}`,
		`{"header":{"event_name":"x","event_id":"e"},"body":{"order":{"order_total":"abc"}}}`,
		`{"header":{"event_name":"x","event_id":"e"},"body":{"order":{"order_items":[1]}}}`} {
		if ParseWebhook(bad) != nil {
			t.Errorf("accepted %s", bad)
		}
	}

	minimal := ParseWebhook(`{"header":{"event_name":"gofood.catalog.menu_mapping_updated","event_id":"e2"},"body":{"outlet":{"id":"G1"}}}`)
	if minimal == nil || minimal.Body.Order != nil {
		t.Fatalf("minimal body: %#v", minimal)
	}
	// Unknown keys are dropped, item defaults filled, numberish strings coerced.
	coerced := ParseWebhook(`{"header":{"event_name":"x","event_id":"e","extra":1},
		"body":{"order":{"order_total":"12500","order_items":[{"external_id":"p","price":""}]}}}`)
	jsonEq(t, coerced, `{"header":{"event_name":"x","event_id":"e"},
		"body":{"order":{"order_total":12500,"order_items":[{"external_id":"p","name":"","quantity":1,"price":0}]}}}`)
	jsonEq(t, ParseWebhook(`{"header":{"event_name":"x","event_id":"e"}}`), `{"header":{"event_name":"x","event_id":"e"},"body":{}}`)
}

func TestSummarize(t *testing.T) {
	s := Summarize(ParseWebhook(sampleEvent))
	eq(t, s.GofoodOrderID, "F-123456789")
	eq(t, s.GofoodOrderType, "delivery")
	eq(t, *s.OutletID, "G123456789")
	eq(t, s.OrderTotal, 40000.0)
	eq(t, *s.CustomerName, "GoFood Customer")
	eq(t, *s.DriverName, "GoFood Driver")
	eq(t, *s.Pin, "1234")
	eq(t, s.CutleryRequested, true)
	eq(t, s.CancelReason, (*string)(nil))
	eq(t, len(s.Items), 3)

	eq(t, OrderTypeFromServiceType(ptr("gofood_pickup")), "pickup")
	eq(t, OrderTypeFromServiceType(ptr("gofood")), "delivery")
	eq(t, OrderTypeFromServiceType(nil), "delivery")
}

func TestMapItems(t *testing.T) {
	products := map[string]ProductRef{
		"prod-1": {ID: "prod-1", Name: "Burger BCD", SKU: "BRG-01", Station: "kitchen", Variants: []RefVariant{{"v-keju", "Keju"}}},
	}
	items := Summarize(ParseWebhook(sampleEvent)).Items
	got := MapItems(items, products)
	eq(t, got.Lines, []MappedLine{{
		ProductID: "prod-1", ProductName: "Burger BCD", ProductSKU: "BRG-01", Quantity: 2, UnitPrice: 15000,
		VariantName: ptr("Keju"), Notes: ptr("pedas"), Station: "kitchen",
	}})
	reasons := [][2]string{}
	for _, u := range got.Unmapped {
		reasons = append(reasons, [2]string{u.Name, u.Reason})
	}
	eq(t, reasons, [][2]string{{"Misterius", "product_not_found"}, {"Tanpa id", "no_external_id"}})

	unknown := MapItems([]Item{{ExternalID: ptr("prod-1"), Name: "x", Quantity: 1, Price: 1, Variants: &[]Variant{{Name: ptr("Extra")}}}}, products)
	eq(t, *unknown.Lines[0].VariantName, "Extra")
}

func TestMapItemsAddons(t *testing.T) {
	products := map[string]ProductRef{"prod-latte": {
		ID: "prod-latte", Name: "Iced Latte", SKU: "LATTE", Station: "bar",
		Modifiers: []RefModifier{{"m-shot", "Extra Shot Espresso", "Tambahan Espresso", 12000}, {"m-oat", "Oat Milk", "Pilihan Susu", 6000}},
	}}
	got := MapItems([]Item{
		{ExternalID: ptr("prod-latte"), Name: "Iced Latte", Quantity: 1, Price: 48000, Variants: &[]Variant{
			{ExternalID: ptr("m-shot"), Name: ptr("Extra Shot Espresso")},
			{ExternalID: ptr("m-oat"), Name: ptr("Oat Milk")},
			{ExternalID: ptr("m-hilang"), Name: ptr("Less Ice")},
		}},
		{ExternalID: ptr("prod-latte"), Name: "Iced Latte", Quantity: 1, Price: 30000},
	}, products)
	eq(t, got.Lines[0].Modifiers, []LineModifier{{"Extra Shot Espresso", "Tambahan Espresso", 12000}, {"Oat Milk", "Pilihan Susu", 6000}})
	eq(t, *got.Lines[0].VariantName, "Less Ice")
	eq(t, got.Lines[0].UnitPrice, 48000.0)
	// Without add-ons the modifiers key is absent (the old shape).
	jsonEq(t, got.Lines[1], `{"product_id":"prod-latte","product_name":"Iced Latte","product_sku":"LATTE","quantity":1,
		"unit_price":30000,"variant_name":null,"notes":null,"station":"bar"}`)
}

func TestStatusMachine(t *testing.T) {
	eq(t, StatusFromEventName("gofood.order.awaiting_merchant_acceptance"), "awaiting_acceptance")
	eq(t, StatusFromEventName("gofood.order.merchant_accepted"), "accepted")
	eq(t, StatusFromEventName("gofood.order.cancelled"), "cancelled")
	eq(t, StatusFromEventName("gofood.order.webhook_error"), "")

	cases := []struct {
		cur, next string
		want      bool
	}{
		{"awaiting_acceptance", "accepted", true},
		{"accepted", "awaiting_acceptance", false},
		{"driver_arrived", "driver_otw_pickup", false},
		{"accepted", "cancelled", true},
		{"cancelled", "accepted", false},
		{"completed", "cancelled", false},
		{"accepted", "accepted", false},
	}
	for _, c := range cases {
		if got := ShouldAdvanceStatus(c.cur, c.next); got != c.want {
			t.Errorf("ShouldAdvanceStatus(%s, %s) = %v", c.cur, c.next, got)
		}
	}
}

// Real sandbox payload (2026-09-28): empty fields arrive as null.
func TestParseWebhookRealSandbox(t *testing.T) {
	real := `{"header":{"version":1,"timestamp":"2026-09-28T21:22:50.446+07:00","event_name":"gofood.order.merchant_accepted",
	  "event_id":"d6e031a7-bedc-3e5b-add0-10b6cedc931e"},
	  "body":{"service_type":"gofood","outlet":{"id":"G799456240","external_outlet_id":null},"customer":{"id":"c-1","name":null},
	  "driver":null,"order":{"takeaway_charges":0,"status":"MERCHANT_ACCEPTED","scheduled_flag":null,"pin":"7767","order_total":338000,
	  "order_number":"F-885936681","cancellation_detail":null,"order_items":[
	    {"variants":[],"sku_promo_id":null,"quantity":1,"price":108000,"notes":"Less sugar","name":"1 Litre Iced Bold","external_id":"p-1"},
	    {"variants":[{"id":"v-1","name":"Extra Shot Espresso","external_id":"m-shot"}],"sku_promo_id":null,"quantity":2,"price":40000,
	     "notes":null,"name":"Iced Bold","external_id":"p-2"}]}}}`
	ev := ParseWebhook(real)
	if ev == nil {
		t.Fatal("null fields rejected the event")
	}
	eq(t, *ev.Body.Outlet.ID, "G799456240")
	eq(t, *ev.Body.Order.OrderNumber, "F-885936681")
	items := *ev.Body.Order.OrderItems
	eq(t, len(items), 2)
	eq(t, *(*items[1].Variants)[0].ExternalID, "m-shot")
	eq(t, *items[0].Notes, "Less sugar")

	cat := ParseWebhook(`{"header":{"version":1,"event_name":"gofood.catalog.menu_mapping_updated","event_id":"e-cat"},
	  "body":{"request_id":"r","outlet":{"id":"G799456240","external_outlet_id":null},"menus":[{"id":"m","external_menu_id":"x"}]}}`)
	eq(t, cat.Header.EventName, "gofood.catalog.menu_mapping_updated")

	var v any
	_ = json.Unmarshal([]byte(`{"a":null,"b":{"c":null,"d":1},"e":[null,{"f":null}]}`), &v)
	jsonEq(t, StripNulls(v), `{"b":{"d":1},"e":[{}]}`)
}

func TestProductIDs(t *testing.T) {
	id := "6f9619ff-8b86-4011-b42d-00cf4fc964ff"
	eq(t, ProductIDs([]Item{{ExternalID: ptr(id)}, {ExternalID: ptr(id)}, {ExternalID: ptr("prod-1")}, {}}), []string{id})
}

/* ── catalog.test.ts ─────────────────────────────────────────────────── */

const appURL = "https://poskopi.reddie.id"

func TestBuildCatalog(t *testing.T) {
	payload, stats := BuildCatalog([]CatalogProduct{
		{ID: "p-kopi", Name: "Es Kopi Susu", Description: ptr("  Signature  "), Price: 25000, Image: ptr("/products/kopi-susu.png"),
			InStock: true, CategoryName: ptr("Kopi"), Variants: []CatalogVariant{
				{ID: "v-ice", Name: "Ice", GroupName: ptr("Suhu")}, {ID: "v-oat", Name: "Oat", PriceAdjustment: 8000, GroupName: ptr("Suhu")}}},
		{ID: "p-teh", Name: "Es Teh", Price: 12000, CategoryName: ptr("Non-Kopi")},
	}, appURL, "req-1")
	jsonEq(t, payload, `{"request_id":"req-1","menus":[
	  {"name":"Kopi","menu_items":[{"external_id":"p-kopi","name":"Es Kopi Susu","description":"Signature","in_stock":true,"price":25000,
	    "image":"https://poskopi.reddie.id/products/kopi-susu.png","variant_category_external_ids":["vc:p-kopi"]}]},
	  {"name":"Non-Kopi","menu_items":[{"external_id":"p-teh","name":"Es Teh","in_stock":false,"price":12000}]}],
	  "variant_categories":[{"external_id":"vc:p-kopi","internal_name":"Es Kopi Susu — Suhu","name":"Suhu",
	    "rules":{"selection":{"min_quantity":1,"max_quantity":1}},
	    "variants":[{"external_id":"v-ice","name":"Ice","price":0,"in_stock":true},{"external_id":"v-oat","name":"Oat","price":8000,"in_stock":true}]}]}`)
	jsonEq(t, stats, `{"menus":2,"items":2,"variantCategories":1,"skipped":[]}`)
}

func TestBuildCatalogSkipsAndClamps(t *testing.T) {
	long := strings.Repeat("x", 200)
	payload, stats := BuildCatalog([]CatalogProduct{
		{ID: "a", Name: "Gratis", InStock: true},
		{ID: "b", Name: "   ", Price: 1000, InStock: true},
		{ID: "c", Name: long, Price: 1000.4, InStock: true},
	}, appURL, "r")
	eq(t, []string{stats.Skipped[0].ID, stats.Skipped[1].ID}, []string{"a", "b"})
	eq(t, len(payload.Menus), 1)
	eq(t, payload.Menus[0].Name, "Menu")
	eq(t, len(payload.Menus[0].MenuItems[0].Name), 150)
	eq(t, payload.Menus[0].MenuItems[0].Price, 1000.0)

	neg, _ := BuildCatalog([]CatalogProduct{{ID: "p", Name: "Ayam", Price: 30000, InStock: true,
		Variants: []CatalogVariant{{ID: "v", Name: "Tanpa nasi", PriceAdjustment: -5000}}}}, appURL, "r")
	eq(t, neg.VariantCategories[0].Variants[0].Price, 0.0)
	eq(t, neg.VariantCategories[0].Name, "Pilihan")
}

var gofoodRule = ChannelRule{Code: "gofood", Name: "GoFood", MarkupPercent: 20, RoundingStep: 1000, RoundingMode: "up", IsActive: true}

func TestPriceForChannel(t *testing.T) {
	products := []CatalogProduct{
		{ID: "p-latte", Name: "Iced Latte", Price: 28000, InStock: true, Variants: []CatalogVariant{
			{ID: "v-reg", Name: "Regular"}, {ID: "v-oat", Name: "Oat", PriceAdjustment: 5000}}},
		{ID: "p-black", Name: "Iced Black", Price: 25000, InStock: true},
	}
	priced := PriceForChannel(products, gofoodRule, map[string]float64{"p-black": 29000})
	eq(t, priced[0].Price, 34000.0) // 28.000 × 1,2 = 33.600 → 34.000
	eq(t, []float64{priced[0].Variants[0].PriceAdjustment, priced[0].Variants[1].PriceAdjustment}, []float64{0, 6000})
	eq(t, priced[1].Price, 29000.0)
	eq(t, products[0].Price, 28000.0)
	eq(t, products[0].Variants[1].PriceAdjustment, 5000.0)

	payload, _ := BuildCatalog(priced, appURL, "r-1")
	eq(t, payload.Menus[0].MenuItems[0].Price, 34000.0)
	eq(t, payload.VariantCategories[0].Variants[1].Price, 6000.0)

	off := gofoodRule
	off.IsActive = false
	base := PriceForChannel(products, off, map[string]float64{"p-black": 29000})
	eq(t, []float64{base[0].Price, base[1].Price}, []float64{28000, 25000})
	eq(t, base[0].Variants[1].PriceAdjustment, 5000.0)
}

func TestRoundToStep(t *testing.T) {
	eq(t, RoundToStep(21600, 1000, "up"), 22000.0)
	eq(t, RoundToStep(18000*1.2, 1000, "up"), 22000.0) // 21599.999… cleaned to 21600 first
	eq(t, RoundToStep(21600, 1000, "down"), 21000.0)
	eq(t, RoundToStep(21500, 1000, "nearest"), 22000.0)
	eq(t, RoundToStep(-1, 100, "up"), 0.0)
	// "down" never goes below the base price.
	eq(t, ApplyChannelMarkup(21600, ChannelRule{MarkupPercent: 1, RoundingStep: 1000, RoundingMode: "down", IsActive: true}), 21600.0)
}

func TestCatalogAddons(t *testing.T) {
	shot := ModifierGroup{ID: "g-shot", Name: "Tambahan Espresso", MaxSelection: 1, Modifiers: []Modifier{{"m-shot", "Extra Shot Espresso", 10000}}}
	milk := ModifierGroup{ID: "g-milk", Name: "Pilihan Susu", MaxSelection: 1, Modifiers: []Modifier{{"m-oat", "Oat Milk", 5000}}}
	products := []CatalogProduct{
		{ID: "p-latte", Name: "Iced Latte", Price: 28000, InStock: true, ModifierGroups: []ModifierGroup{shot, milk}},
		{ID: "p-espresso", Name: "Espresso", Price: 15000, InStock: true, ModifierGroups: []ModifierGroup{shot}},
		{ID: "p-black", Name: "Hot Black", Price: 20000, InStock: true},
	}
	payload, stats := BuildCatalog(products, appURL, "r")
	jsonEq(t, payload.VariantCategories, `[
	  {"external_id":"mg:g-shot","internal_name":"Add-on — Tambahan Espresso","name":"Tambahan Espresso",
	   "rules":{"selection":{"min_quantity":0,"max_quantity":1}},
	   "variants":[{"external_id":"m-shot","name":"Extra Shot Espresso","price":10000,"in_stock":true}]},
	  {"external_id":"mg:g-milk","internal_name":"Add-on — Pilihan Susu","name":"Pilihan Susu",
	   "rules":{"selection":{"min_quantity":0,"max_quantity":1}},
	   "variants":[{"external_id":"m-oat","name":"Oat Milk","price":5000,"in_stock":true}]}]`)
	eq(t, stats.VariantCategories, 2)
	items := payload.Menus[0].MenuItems
	eq(t, items[0].VariantCategoryExternalIDs, []string{"mg:g-shot", "mg:g-milk"})
	eq(t, items[1].VariantCategoryExternalIDs, []string{"mg:g-shot"})
	eq(t, items[2].VariantCategoryExternalIDs, []string(nil))

	espresso := products[1]
	espresso.Variants = []CatalogVariant{{ID: "v-s", Name: "Single", GroupName: ptr("Ukuran")}}
	both, _ := BuildCatalog([]CatalogProduct{espresso}, appURL, "r")
	eq(t, both.Menus[0].MenuItems[0].VariantCategoryExternalIDs, []string{VariantCategoryID("p-espresso"), "mg:g-shot"})

	marked, _ := BuildCatalog(PriceForChannel(products, gofoodRule, nil), appURL, "r")
	eq(t, []float64{marked.VariantCategories[0].Variants[0].Price, marked.VariantCategories[1].Variants[0].Price}, []float64{12000, 6000})
	eq(t, products[0].ModifierGroups[0].Modifiers[0].PriceAdjustment, 10000.0)

	empty := milk
	empty.ID, empty.Modifiers = "g-kosong", nil
	none, _ := BuildCatalog([]CatalogProduct{{ID: "p", Name: "Hot Black", Price: 20000, ModifierGroups: []ModifierGroup{empty}}}, appURL, "r")
	eq(t, none.VariantCategories, []VariantCategory{})
	two := milk
	two.Modifiers = append(two.Modifiers, Modifier{"m-almond", "Almond", 6000})
	two.MinSelection, two.MaxSelection = 1, 5
	eq(t, ModifierSelection(two), Selection{1, 2})
	two.MinSelection, two.MaxSelection = 3, 0
	eq(t, ModifierSelection(two), Selection{1, 1})
}

/* ── image.test.ts ───────────────────────────────────────────────────── */

func TestImageURL(t *testing.T) {
	eq(t, ImageURL("/products/a.png", appURL), appURL+"/products/a.png")
	eq(t, ImageURL("/products/a.JPG", appURL+"/"), appURL+"/products/a.JPG")
	url := ImageURL("/products/bcd/bcd-palm-02.webp", appURL)
	if !regexp.MustCompile(`^https://poskopi\.reddie\.id/api/public/gofood-image/[A-Za-z0-9_-]+\.jpg$`).MatchString(url) {
		t.Fatalf("converter url %q", url)
	}
	token := strings.TrimSuffix(url[strings.LastIndex(url, "/")+1:], ".jpg")
	src, _ := base64.RawURLEncoding.DecodeString(token)
	eq(t, string(src), "/products/bcd/bcd-palm-02.webp")

	if !strings.Contains(ImageURL("/api/files/products/x.webp", appURL), ImageRoute) {
		t.Fatal("storage upload not converted")
	}
	eq(t, ImageURL("https://cdn.example.com/a.webp", appURL), "")
	eq(t, ImageURL("https://cdn.example.com/a.jpg?w=1", appURL), "https://cdn.example.com/a.jpg?w=1")
	eq(t, ImageURL("/etc/passwd", appURL), "")
	eq(t, ImageURL("", appURL), "")
	eq(t, ImageURL("/products/a.webp", ""), "")
	eq(t, ImageURL("/products/../../.env", appURL), "")
}
