package domain

import (
	"encoding/json"
	"math"
	"reflect"
	"testing"
)

// order-pricing.test.ts
func TestItemPriceMath(t *testing.T) {
	item := Obj{"unit_price": "20000", "variant_price_adjustment": json.Number("5000"), "modifier_price_adjustment": "2500", "quantity": json.Number("2")}
	if got := ItemUnitPrice(item); got != 27500 {
		t.Errorf("ItemUnitPrice = %v, want 27500", got)
	}
	if got := ItemLineSubtotal(item); got != 55000 {
		t.Errorf("ItemLineSubtotal = %v, want 55000", got)
	}

	qty := []struct {
		name string
		item Obj
		want float64
	}{
		{"missing", Obj{}, 1},
		{"zero", Obj{"quantity": json.Number("0")}, 1},
		{"garbage", Obj{"quantity": "abc"}, 1},
		{"string", Obj{"quantity": "3"}, 3},
		{"null", Obj{"quantity": nil}, 1},
		{"decimal", Obj{"quantity": json.Number("1.5")}, 1.5},
	}
	for _, c := range qty {
		if got := ItemQuantity(c.item); got != c.want {
			t.Errorf("ItemQuantity(%s) = %v, want %v", c.name, got, c.want)
		}
	}

	if got := ItemUnitPrice(Obj{"unit_price": "x", "variant_price_adjustment": Undefined{}}); got != 0 {
		t.Errorf("invalid prices = %v, want 0", got)
	}
	if got := ItemsSubtotal([]Obj{
		{"unit_price": json.Number("10000"), "quantity": json.Number("2")},
		{"unit_price": json.Number("15000"), "modifier_price_adjustment": json.Number("3000")},
	}); got != 38000 {
		t.Errorf("ItemsSubtotal = %v, want 38000", got)
	}
	if got := ItemsSubtotal(nil); got != 0 {
		t.Errorf("ItemsSubtotal(nil) = %v", got)
	}
}

func TestParseDiscountTypeAndNullableNumber(t *testing.T) {
	types := []struct {
		in   any
		want string
	}{
		{"percent", "percent"},
		{"fixed", "fixed"},
		{"PERCENT", ""},
		{nil, ""},
		{Undefined{}, ""},
		{json.Number("1"), ""},
	}
	for _, c := range types {
		if got := ParseDiscountType(c.in); got != c.want {
			t.Errorf("ParseDiscountType(%v) = %q, want %q", c.in, got, c.want)
		}
	}

	nulls := []any{nil, Undefined{}, ""}
	for _, in := range nulls {
		if got := ParseNullableNumber(in); got != nil {
			t.Errorf("ParseNullableNumber(%v) = %v, want nil", in, *got)
		}
	}
	nums := []struct {
		in   any
		want float64
	}{
		{"10", 10},
		{json.Number("0"), 0},
		{" ", 0},
		{"abc", math.NaN()},
	}
	for _, c := range nums {
		got := ParseNullableNumber(c.in)
		if got == nil || !sameFloat(*got, c.want) {
			t.Errorf("ParseNullableNumber(%v) = %v, want %v", c.in, got, c.want)
		}
	}
}

func TestBuildLineInputs(t *testing.T) {
	got := BuildLineInputs([]Obj{
		{"unit_price": json.Number("10000"), "quantity": json.Number("2"), "discount_type": "percent", "discount_value": "10"},
		{"unit_price": json.Number("5000"), "discount_type": "bogus", "discount_value": ""},
	})
	want := []LineInput{
		{LineSubtotal: 20000, DiscountType: "percent", DiscountValue: ptr(10)},
		{LineSubtotal: 5000},
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("BuildLineInputs = %+v, want %+v", got, want)
	}
}

func TestTrustedTotal(t *testing.T) {
	derived := 100000.0 - 10000 + 9000 + 5000 + 1000
	cases := []struct {
		name   string
		method string
		promo  bool
		client any
		want   float64
	}{
		{"client total trusted", "cash", false, json.Number("99999"), 99999},
		{"undefined falls back", "cash", false, Undefined{}, derived},
		{"zero falls back", "cash", false, json.Number("0"), derived},
		{"string client total", "cash", false, "88000", 88000},
		{"nfc_tab derives", "nfc_tab", false, json.Number("99999"), derived},
		{"gift_card derives", "gift_card", false, json.Number("99999"), derived},
		{"promo hold derives", "cash", true, json.Number("99999"), derived},
	}
	for _, c := range cases {
		if got := TrustedTotal(c.method, c.promo, c.client, 100000, 10000, 9000, 5000, 1000); got != c.want {
			t.Errorf("%s: got %v, want %v", c.name, got, c.want)
		}
	}
}

func TestChangeAmount(t *testing.T) {
	cases := []struct{ paid, ark, total, want float64 }{
		{100000, 0, 85000, 15000},
		{50000, 40000, 85000, 5000},
		{10000, 0, 85000, 0},
	}
	for _, c := range cases {
		if got := ChangeAmount(c.paid, c.ark, c.total); got != c.want {
			t.Errorf("ChangeAmount(%v,%v,%v) = %v, want %v", c.paid, c.ark, c.total, got, c.want)
		}
	}
}

// buildCostSnapshot (purchasing-sync.ts) as used by buildOrderItemRows.
func TestBuildCostSnapshot(t *testing.T) {
	cases := []struct {
		name             string
		cost, qty, total float64
		want             CostSnapshot
	}{
		{"order item row", 4000, 2, 40000, CostSnapshot{CostPrice: 4000, CostTotal: 8000, GrossProfit: 32000, GrossMarginPct: 80}},
		{"no cost", 0, 1, 0, CostSnapshot{}},
		{"rounding to cents", 1.005, 3, 10, CostSnapshot{CostPrice: 1.005, CostTotal: 3.01, GrossProfit: 6.99, GrossMarginPct: 69.9}},
		{"negative profit", 5000, 1, 3000, CostSnapshot{CostPrice: 5000, CostTotal: 5000, GrossProfit: -2000, GrossMarginPct: -66.67}},
		{"non finite cost is 0", math.NaN(), 1, 100, CostSnapshot{CostPrice: 0, CostTotal: 0, GrossProfit: 100, GrossMarginPct: 100}},
	}
	for _, c := range cases {
		if got := BuildCostSnapshot(c.cost, c.qty, c.total); got != c.want {
			t.Errorf("%s: got %+v, want %+v", c.name, got, c.want)
		}
	}
}

// manual-discount.test.ts
func TestDiscountAmount(t *testing.T) {
	cases := []struct {
		name  string
		basis float64
		typ   string
		value *float64
		want  float64
	}{
		{"percent", 10000, "percent", ptr(10), 1000},
		{"percent floors", 999, "percent", ptr(10), 99},
		{"percent capped at 100", 100, "percent", ptr(150), 100},
		{"fixed", 10000, "fixed", ptr(2500), 2500},
		{"fixed capped to basis", 1000, "fixed", ptr(5000), 1000},
		{"no type", 10000, "", ptr(10), 0},
		{"zero value", 10000, "percent", ptr(0), 0},
		{"zero basis", 0, "fixed", ptr(100), 0},
		{"nil value", 10000, "fixed", nil, 0},
		{"NaN value", 10000, "fixed", ptr(math.NaN()), 0},
		{"fixed floors", 10000, "fixed", ptr(99.9), 99},
		{"negative basis", -50, "fixed", ptr(10), 0},
		{"NaN basis", math.NaN(), "fixed", ptr(10), 0},
		{"unknown type acts as fixed", 10000, "bogus", ptr(250), 250},
	}
	for _, c := range cases {
		if got := DiscountAmount(c.basis, c.typ, c.value); got != c.want {
			t.Errorf("%s: got %v, want %v", c.name, got, c.want)
		}
	}
}

func TestComputeDiscountStack(t *testing.T) {
	t.Run("item, membership, promo, manual", func(t *testing.T) {
		s := ComputeDiscountStack(StackInput{
			Items: []LineInput{
				{LineSubtotal: 100000, DiscountType: "percent", DiscountValue: ptr(10)},
				{LineSubtotal: 50000, DiscountType: "fixed", DiscountValue: ptr(5000)},
			},
			MembershipPct: 10,
			PromoDiscount: 8000,
			ManualType:    "percent",
			ManualValue:   ptr(5),
		})
		want := Stack{
			GrossSubtotal:     150000,
			LineDiscountTotal: 15000,
			ItemsSubtotal:     135000,
			MembershipAmount:  13500,
			PromoAmount:       8000,
			ManualAmount:      5675,
			DiscountAmount:    15000 + 13500 + 8000 + 5675,
			AfterDiscount:     135000 - 13500 - 8000 - 5675,
			LineResults:       []LineResult{{DiscountAmount: 10000, TotalAmount: 90000}, {DiscountAmount: 5000, TotalAmount: 45000}},
		}
		if !reflect.DeepEqual(s, want) {
			t.Errorf("stack = %+v, want %+v", s, want)
		}
	})

	t.Run("manual fixed capped to remaining basis", func(t *testing.T) {
		s := ComputeDiscountStack(StackInput{Items: []LineInput{{LineSubtotal: 10000}}, ManualType: "fixed", ManualValue: ptr(99000)})
		if s.ManualAmount != 10000 || s.AfterDiscount != 0 {
			t.Errorf("stack = %+v", s)
		}
	})

	t.Run("offer before membership", func(t *testing.T) {
		s := ComputeDiscountStack(StackInput{Items: []LineInput{{LineSubtotal: 100000}}, OfferDiscount: 20000, MembershipPct: 10})
		if s.OfferAmount != 20000 || s.MembershipAmount != 8000 || s.DiscountAmount != 28000 {
			t.Errorf("stack = %+v", s)
		}
	})

	t.Run("promo capped after membership, offer capped to items", func(t *testing.T) {
		s := ComputeDiscountStack(StackInput{Items: []LineInput{{LineSubtotal: 1000}}, OfferDiscount: 5000, MembershipPct: 10, PromoDiscount: 500})
		if s.OfferAmount != 1000 || s.MembershipAmount != 0 || s.PromoAmount != 0 || s.AfterDiscount != 0 {
			t.Errorf("stack = %+v", s)
		}
		s = ComputeDiscountStack(StackInput{Items: []LineInput{{LineSubtotal: 1000}}, MembershipPct: 10, PromoDiscount: 5000})
		if s.MembershipAmount != 100 || s.PromoAmount != 900 || s.AfterDiscount != 0 {
			t.Errorf("stack = %+v", s)
		}
	})

	t.Run("negative and NaN inputs clamp to 0", func(t *testing.T) {
		s := ComputeDiscountStack(StackInput{Items: []LineInput{{LineSubtotal: -500}, {LineSubtotal: math.NaN()}, {LineSubtotal: 1000}}, OfferDiscount: -10, MembershipPct: math.NaN(), PromoDiscount: -1})
		if s.GrossSubtotal != 1000 || s.ItemsSubtotal != 1000 || s.OfferAmount != 0 || s.MembershipAmount != 0 || s.PromoAmount != 0 || s.AfterDiscount != 1000 {
			t.Errorf("stack = %+v", s)
		}
		if len(s.LineResults) != 3 || s.LineResults[0] != (LineResult{}) {
			t.Errorf("line results = %+v", s.LineResults)
		}
	})
}

func TestBuildDiscountReason(t *testing.T) {
	cases := []struct {
		name string
		in   DiscountReasonInput
		want string
	}{
		{"all segments", DiscountReasonInput{HasItemDiscounts: true, OfferLabels: []string{"Paket Hemat"}, MembershipPct: 10, PromoCode: "SUMMER", ManualType: "percent", ManualValue: ptr(5)},
			"ITEM line discounts; OFFER Paket Hemat; MEMBER 10%; PROMO SUMMER; MANUAL 5%"},
		{"fixed manual", DiscountReasonInput{ManualType: "fixed", ManualValue: ptr(2500)}, "MANUAL Rp 2500"},
		{"fixed manual floors", DiscountReasonInput{ManualType: "fixed", ManualValue: ptr(2500.9)}, "MANUAL Rp 2500"},
		{"decimal member and percent", DiscountReasonInput{MembershipPct: 2.5, ManualType: "percent", ManualValue: ptr(7.5)}, "MEMBER 2.5%; MANUAL 7.5%"},
		{"promo upper cased and trimmed", DiscountReasonInput{PromoCode: "  pos-abc "}, "PROMO POS-ABC"},
		{"blank offer labels skipped", DiscountReasonInput{OfferLabels: []string{" ", "", " Bundle "}}, "OFFER Bundle"},
		{"nothing is null", DiscountReasonInput{MembershipPct: 0, ManualType: "fixed", ManualValue: ptr(0)}, ""},
		{"manual without type", DiscountReasonInput{ManualValue: ptr(10)}, ""},
		{"NaN member skipped", DiscountReasonInput{MembershipPct: math.NaN()}, ""},
	}
	for _, c := range cases {
		if got := BuildDiscountReason(c.in); got != c.want {
			t.Errorf("%s: got %q, want %q", c.name, got, c.want)
		}
	}
}

// format.test.ts
func TestFormatRupiah(t *testing.T) {
	cases := []struct {
		in   float64
		want string
	}{
		{1250000, "Rp1.250.000"},
		{1500.6, "Rp1.501"},
		{-2000, "-Rp2.000"},
		{0, "Rp0"},
		{math.NaN(), "Rp0"},
		{math.Inf(1), "Rp0"},
		{999, "Rp999"},
		{1000, "Rp1.000"},
		{-0.4, "Rp0"},
		{-0.5, "Rp0"},
		{-0.6, "-Rp1"},
		{123456789, "Rp123.456.789"},
	}
	for _, c := range cases {
		if got := FormatRupiah(c.in); got != c.want {
			t.Errorf("FormatRupiah(%v) = %q, want %q", c.in, got, c.want)
		}
	}
}

// queue-number.test.ts
func TestShouldAllocateQueueNumber(t *testing.T) {
	cases := map[string]bool{"": true, "  ": true, "007": false}
	for in, want := range cases {
		if got := ShouldAllocateQueueNumber(in); got != want {
			t.Errorf("ShouldAllocateQueueNumber(%q) = %v, want %v", in, got, want)
		}
	}
}

// order-item-sku.test.ts
func TestIsOpaqueSku(t *testing.T) {
	cases := map[string]bool{
		"1d22f9ac-1861-47a9-8c38-d70fc565f568":     true,
		"SKU-1d22f9ac-1861-47a9-8c38-d70fc565f568": true,
		"sku-1D22F9AC-1861-47A9-8C38-D70FC565F568": true,
		"":                true,
		"   ":             true,
		"MM-STALL-02-005": false,
		"PUR-SND-001":     false,
		"SKU-D":           false,
	}
	for in, want := range cases {
		if got := IsOpaqueSku(in); got != want {
			t.Errorf("IsOpaqueSku(%q) = %v, want %v", in, got, want)
		}
	}
}

func TestPickDisplaySku(t *testing.T) {
	uuid := "1d22f9ac-1861-47a9-8c38-d70fc565f568"
	cases := []struct {
		name                string
		stored, master, pos string
		want                string
	}{
		{"master first", uuid, "MM-STALL-02-005", "PUR-MM-STALL-02-005", "MM-STALL-02-005"},
		{"then POS sku", uuid, "", "PUR-MM-STALL-02-005", "PUR-MM-STALL-02-005"},
		{"then snapshot", "SKU-D", "", "", "SKU-D"},
		{"only uuid", uuid, "", "", ""},
		{"nothing", "", "", "", ""},
		{"opaque POS sku skipped", "SKU-D", "", "SKU-" + uuid, "SKU-D"},
		{"master trimmed", "", " K-1 ", "", "K-1"},
	}
	for _, c := range cases {
		if got := PickDisplaySku(c.stored, c.master, c.pos); got != c.want {
			t.Errorf("%s: got %q, want %q", c.name, got, c.want)
		}
	}
}
