package domain

import (
	"encoding/json"
	"reflect"
	"slices"
	"testing"
)

// Ported from lib/promo/offer-evaluate.test.ts and offer-stacking.test.ts.

const (
	prodA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
	prodB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
	prodC = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
	catD  = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
)

func item(role, product string, qty float64) OfferEvalItem {
	return OfferEvalItem{Role: role, ProductID: product, Qty: qty}
}

func catItem(role, category string) OfferEvalItem {
	return OfferEvalItem{Role: role, CategoryID: ptr(category), Qty: 1}
}

func ruleIDs(applied []AppliedOffer) []string {
	ids := []string{}
	for _, a := range applied {
		ids = append(ids, a.RuleID)
	}
	return ids
}

func TestEvaluateOfferRulesBasics(t *testing.T) {
	bundle := OfferEvalRule{ID: "r1", OfferType: OfferBundle, Name: "Paket", BundlePrice: ptr(70_000.0),
		Items: []OfferEvalItem{item("component", prodA, 1), item("component", prodB, 1)}}
	res := EvaluateOfferRules([]OfferCartLine{{prodA, 1, 45_000}, {prodB, 1, 40_000}}, []OfferEvalRule{bundle}, OfferEvalContext{})
	if res.OfferDiscount != 15_000 || res.Applied[0].Name != "Paket" {
		t.Fatalf("bundle: %+v", res)
	}

	bogo := OfferEvalRule{ID: "r2", OfferType: OfferBxgy, Name: "BOGO", BuyQty: ptr(1), GetQty: ptr(1), GetMode: ptr("same_as_buy"),
		Items: []OfferEvalItem{item("buy", prodA, 1)}}
	res = EvaluateOfferRules([]OfferCartLine{{prodA, 2, 10_000}}, []OfferEvalRule{bogo}, OfferEvalContext{})
	if res.OfferDiscount != 10_000 || !reflect.DeepEqual(res.Applied[0].FreeUnits, []FreeUnit{{prodA, 1, 10_000}}) {
		t.Fatalf("bogo: %+v", res)
	}

	specific := OfferEvalRule{ID: "r3", OfferType: OfferBxgy, Name: "Gratis C", BuyQty: ptr(1), GetQty: ptr(1), GetMode: ptr("specific_products"),
		Items: []OfferEvalItem{item("buy", prodA, 1), item("get", prodC, 1)}}
	res = EvaluateOfferRules([]OfferCartLine{{prodA, 1, 45_000}, {prodC, 1, 15_000}}, []OfferEvalRule{specific}, OfferEvalContext{})
	if res.OfferDiscount != 15_000 {
		t.Fatalf("specific: %+v", res)
	}

	vol := OfferEvalRule{ID: "r4", OfferType: OfferVolume, Name: "Vol 5", VolumeBasis: ptr("qty"), VolumeMin: ptr(5.0),
		DiscountType: ptr("percent"), DiscountValue: ptr(3.0)}
	res = EvaluateOfferRules([]OfferCartLine{{prodA, 5, 10_000}}, []OfferEvalRule{vol}, OfferEvalContext{})
	if res.OfferDiscount != 1_500 {
		t.Fatalf("volume: %+v", res)
	}

	compBundle := OfferEvalRule{ID: "b", OfferType: OfferBundle, Name: "Bundle", BundlePrice: ptr(80_000.0),
		Items: []OfferEvalItem{item("component", prodA, 1), item("component", prodB, 1)}}
	compBxgy := OfferEvalRule{ID: "x", OfferType: OfferBxgy, Name: "BXGY", BuyQty: ptr(1), GetQty: ptr(1), GetMode: ptr("same_as_buy"),
		Items: []OfferEvalItem{item("buy", prodA, 1)}}
	res = EvaluateOfferRules([]OfferCartLine{{prodA, 2, 45_000}, {prodB, 1, 45_000}}, []OfferEvalRule{compBundle, compBxgy}, OfferEvalContext{})
	if res.OfferDiscount != 45_000 || !slices.Contains(ruleIDs(res.Applied), "x") {
		t.Fatalf("bundle vs bxgy: %+v", res)
	}
}

var cart = []OfferCartLine{{prodA, 2, 40_000}, {prodB, 1, 30_000}}

func volume(patch func(*OfferEvalRule)) OfferEvalRule {
	r := OfferEvalRule{ID: "vol", OfferType: OfferVolume, Name: "Volume 10%", VolumeBasis: ptr("qty"), VolumeMin: ptr(1.0),
		DiscountType: ptr("percent"), DiscountValue: ptr(10.0)}
	if patch != nil {
		patch(&r)
	}
	return r
}

func bundleRule(patch func(*OfferEvalRule)) OfferEvalRule {
	r := OfferEvalRule{ID: "bundle", OfferType: OfferBundle, Name: "Latte + Cake", BundlePrice: ptr(55_000.0),
		Items: []OfferEvalItem{item("component", prodA, 1), item("component", prodB, 1)}}
	if patch != nil {
		patch(&r)
	}
	return r
}

func bogoRule(patch func(*OfferEvalRule)) OfferEvalRule {
	r := OfferEvalRule{ID: "bogo", OfferType: OfferBxgy, Name: "Latte B1G1", BuyQty: ptr(1), GetQty: ptr(1), GetMode: ptr("same_as_buy"),
		Items: []OfferEvalItem{item("buy", prodA, 1)}}
	if patch != nil {
		patch(&r)
	}
	return r
}

func TestOfferStacking(t *testing.T) {
	exclusive := func(id string, value float64, priority int) OfferEvalRule {
		return volume(func(r *OfferEvalRule) {
			r.ID, r.DiscountValue, r.IsExclusive, r.Priority = id, ptr(value), true, priority
		})
	}
	fixed := func(id string, exclusive bool) OfferEvalRule {
		return volume(func(r *OfferEvalRule) {
			r.ID, r.DiscountType, r.DiscountValue, r.IsExclusive = id, ptr("fixed"), ptr(10_000.0), exclusive
		})
	}
	cases := []struct {
		name     string
		lines    []OfferCartLine
		rules    []OfferEvalRule
		ctx      OfferEvalContext
		sorted   bool // compare ids sorted
		wantIDs  []string
		discount float64 // -1 = not asserted
	}{
		{"non-eksklusif digabung", cart, []OfferEvalRule{bundleRule(nil), volume(nil)}, OfferEvalContext{}, true, []string{"bundle", "vol"}, 26_000},
		{"eksklusif kalah", cart, []OfferEvalRule{bundleRule(nil), volume(nil), exclusive("ex", 20, 0)}, OfferEvalContext{}, true, []string{"bundle", "vol"}, 26_000},
		{"eksklusif menang", cart, []OfferEvalRule{bundleRule(nil), volume(nil), exclusive("ex", 30, 0)}, OfferEvalContext{}, false, []string{"ex"}, 33_000},
		{"seri = eksklusif", cart, []OfferEvalRule{fixed("a", false), fixed("ex", true)}, OfferEvalContext{}, false, []string{"ex"}, -1},
		{"prioritas eksklusif", cart, []OfferEvalRule{exclusive("big", 30, 0), exclusive("vip", 20, 5)}, OfferEvalContext{}, false, []string{"vip"}, 22_000},
		{"eksklusif tanpa diskon", cart, []OfferEvalRule{volume(nil), volume(func(r *OfferEvalRule) { r.ID, r.VolumeMin, r.IsExclusive = "ex", ptr(99.0), true })},
			OfferEvalContext{}, false, []string{"vol"}, -1},
		{"prioritas sama = diskon terbesar", cart, []OfferEvalRule{bundleRule(nil), bogoRule(nil)}, OfferEvalContext{}, false, []string{"bogo"}, 40_000},
		{"prioritas memesan qty dulu", cart, []OfferEvalRule{bundleRule(func(r *OfferEvalRule) { r.Priority = 10 }), bogoRule(nil)}, OfferEvalContext{}, false, []string{"bundle"}, 15_000},
		{"dua volume", cart, []OfferEvalRule{volume(func(r *OfferEvalRule) { r.ID, r.DiscountValue = "v5", ptr(5.0) }), volume(func(r *OfferEvalRule) { r.ID = "v10" })},
			OfferEvalContext{}, false, []string{"v10"}, -1},
		{"kuota habis dilewati", cart, []OfferEvalRule{volume(func(r *OfferEvalRule) { r.MaxUses, r.UsedCount = ptr(100), 100 })}, OfferEvalContext{}, false, []string{}, -1},
		{"kuota belum habis", cart, []OfferEvalRule{volume(func(r *OfferEvalRule) { r.MaxUses, r.UsedCount = ptr(100), 99 })}, OfferEvalContext{}, false, []string{"vol"}, -1},
		{"channel tidak terdaftar", cart, []OfferEvalRule{volume(func(r *OfferEvalRule) { r.SalesChannels = []string{"self_order"} })}, OfferEvalContext{Channel: "pos"}, false, []string{}, -1},
		{"channel terdaftar", cart, []OfferEvalRule{volume(func(r *OfferEvalRule) { r.SalesChannels = []string{"self_order"} })}, OfferEvalContext{Channel: "self_order"}, false, []string{"vol"}, -1},
	}
	for _, tc := range cases {
		res := EvaluateOfferRules(tc.lines, tc.rules, tc.ctx)
		ids := ruleIDs(res.Applied)
		if tc.sorted {
			slices.Sort(ids)
		}
		if !slices.Equal(ids, tc.wantIDs) {
			t.Errorf("%s: applied %v want %v", tc.name, ids, tc.wantIDs)
		}
		if tc.discount >= 0 && res.OfferDiscount != tc.discount {
			t.Errorf("%s: discount %v want %v", tc.name, res.OfferDiscount, tc.discount)
		}
	}
}

func TestOfferDiscountNeverExceedsSubtotal(t *testing.T) {
	res := EvaluateOfferRules([]OfferCartLine{{prodA, 1, 10_000}}, []OfferEvalRule{
		volume(func(r *OfferEvalRule) { r.ID, r.DiscountType, r.DiscountValue = "a", ptr("fixed"), ptr(8_000.0) }),
		bogoRule(func(r *OfferEvalRule) {
			r.ID, r.GetMode = "b", ptr("specific_products")
			r.Items = []OfferEvalItem{item("buy", prodA, 1), item("get", prodA, 1)}
		}),
	}, OfferEvalContext{})
	if res.OfferDiscount > 10_000 {
		t.Fatalf("discount %v", res.OfferDiscount)
	}
}

func TestOfferCaps(t *testing.T) {
	if got := OfferSkipReason(volume(func(r *OfferEvalRule) { r.MaxUses, r.UsedCount = ptr(100), 100 }), OfferEvalContext{}); got != SkipQuotaUsed {
		t.Errorf("total quota: %q", got)
	}
	if got := OfferCapReason(OfferCaps{MaxUsesPerMember: ptr(1), MemberUsedCount: 1}); got != SkipMemberLimit {
		t.Errorf("member limit: %q", got)
	}
	if got := OfferCapReason(OfferCaps{MaxUsesPerMember: ptr(2), MemberUsedCount: 1}); got != "" {
		t.Errorf("member limit left: %q", got)
	}
	if got := OfferSkipReason(volume(func(r *OfferEvalRule) { r.MaxUsesPerMember = ptr(1) }), OfferEvalContext{}); got != "" {
		t.Errorf("no member counts as 0: %q", got)
	}
	if got := OfferCapReason(OfferCaps{MaxUses: ptr(1), UsedCount: 1, MaxUsesPerMember: ptr(1), MemberUsedCount: 1}); got != SkipQuotaUsed {
		t.Errorf("total first: %q", got)
	}
	if got := OfferSkipReason(volume(func(r *OfferEvalRule) { r.SalesChannels = []string{} }), OfferEvalContext{Channel: "gofood"}); got != "" {
		t.Errorf("empty channels: %q", got)
	}
	if got := OfferSkipReason(volume(nil), OfferEvalContext{Channel: "pos"}); got != "" {
		t.Errorf("nil channels: %q", got)
	}
	if got := OfferSkipReason(volume(func(r *OfferEvalRule) { r.SalesChannels = []string{"self_order"} }), OfferEvalContext{Channel: "pos"}); got != SkipChannel {
		t.Errorf("channel: %q", got)
	}
}

func TestCodedOffers(t *testing.T) {
	coded := volume(func(r *OfferEvalRule) { r.ID, r.RequiresCode, r.DiscountValue = "kode", true, ptr(15.0) })
	if got := OfferSkipReason(coded, OfferEvalContext{}); got != SkipCode {
		t.Errorf("skip: %q", got)
	}
	if got := EvaluateOfferRules(cart, []OfferEvalRule{coded}, OfferEvalContext{}).OfferDiscount; got != 0 {
		t.Errorf("locked discount %v", got)
	}
	unlocked := OfferEvalContext{UnlockedRuleIDs: []string{"kode"}}
	res := EvaluateOfferRules(cart, []OfferEvalRule{coded}, unlocked)
	if !slices.Equal(ruleIDs(res.Applied), []string{"kode"}) || res.OfferDiscount != 16_500 {
		t.Errorf("unlocked: %+v", res)
	}
	other := volume(func(r *OfferEvalRule) { r.ID, r.RequiresCode = "lain", true })
	if ids := ruleIDs(EvaluateOfferRules(cart, []OfferEvalRule{coded, other}, unlocked).Applied); !slices.Equal(ids, []string{"kode"}) {
		t.Errorf("one code opens one offer: %v", ids)
	}
	ex := volume(func(r *OfferEvalRule) { r.ID, r.DiscountValue, r.IsExclusive = "ex", ptr(50.0), true })
	if ids := ruleIDs(EvaluateOfferRules(cart, []OfferEvalRule{ex, coded}, unlocked).Applied); !slices.Equal(ids, []string{"ex"}) {
		t.Errorf("coded obeys exclusive: %v", ids)
	}
}

func TestCategoryTargets(t *testing.T) {
	byCategory := map[string][]string{catD: {prodA, prodC}}

	rule := ExpandCategoryTargets([]OfferEvalRule{volume(func(r *OfferEvalRule) { r.Items = []OfferEvalItem{catItem("eligible", catD)} })}, byCategory)[0]
	if got := EvaluateOfferRules(cart, []OfferEvalRule{rule}, OfferEvalContext{}).OfferDiscount; got != 8_000 {
		t.Errorf("volume per category: %v", got)
	}

	rule = ExpandCategoryTargets([]OfferEvalRule{bogoRule(func(r *OfferEvalRule) { r.Items = []OfferEvalItem{catItem("buy", catD)} })}, byCategory)[0]
	if got := EvaluateOfferRules([]OfferCartLine{{prodA, 1, 40_000}, {prodC, 1, 25_000}}, []OfferEvalRule{rule}, OfferEvalContext{}).OfferDiscount; got != 25_000 {
		t.Errorf("bxgy category pool: %v", got)
	}

	rule = ExpandCategoryTargets([]OfferEvalRule{volume(func(r *OfferEvalRule) { r.Items = []OfferEvalItem{catItem("eligible", "kosong")} })}, byCategory)[0]
	if got := EvaluateOfferRules(cart, []OfferEvalRule{rule}, OfferEvalContext{}).OfferDiscount; got != 0 {
		t.Errorf("empty category: %v", got)
	}

	rule = ExpandCategoryTargets([]OfferEvalRule{volume(func(r *OfferEvalRule) {
		r.Items = []OfferEvalItem{item("eligible", prodA, 1), catItem("eligible", catD)}
	})}, byCategory)[0]
	var products []string
	for _, i := range rule.Items {
		products = append(products, i.ProductID)
	}
	if !slices.Equal(products, []string{prodA, prodC}) {
		t.Errorf("dedupe: %v", products)
	}

	original := bundleRule(nil)
	if got := ExpandCategoryTargets([]OfferEvalRule{original}, byCategory)[0]; !reflect.DeepEqual(got, original) {
		t.Errorf("rule without categories changed: %+v", got)
	}
}

func TestOfferEvalItemJSON(t *testing.T) {
	rule := ExpandCategoryTargets([]OfferEvalRule{volume(func(r *OfferEvalRule) {
		r.Items = []OfferEvalItem{item("eligible", prodB, 1), catItem("eligible", catD), catItem("eligible", "kosong")}
	})}, map[string][]string{catD: {prodA}})[0]
	raw, _ := json.Marshal(rule.Items)
	want := `[{"role":"eligible","product_id":"` + prodB + `","category_id":null,"qty":1},` +
		`{"role":"eligible","product_id":"` + prodA + `","qty":1},` +
		`{"role":"eligible","product_id":"","category_id":"kosong","qty":1}]`
	if string(raw) != want {
		t.Fatalf("got %s\nwant %s", raw, want)
	}
}
