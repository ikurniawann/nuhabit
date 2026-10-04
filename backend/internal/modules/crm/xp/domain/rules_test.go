package domain

import (
	"testing"
	"time"
)

func f(v float64) *float64 { return &v }
func s(v string) *string   { return &v }

func rule(mod func(*Rule)) Rule {
	r := Rule{ID: "r1", SourceType: "order_amount", OutletScope: "all", XPMode: "fixed", XPValue: 10, AmountStep: 1}
	if mod != nil {
		mod(&r)
	}
	return r
}

func TestIsXPEligiblePayment(t *testing.T) {
	for in, want := range map[string]bool{"ark_coin": true, "ARK_COIN": true, "cash": false, "": false} {
		if IsXPEligiblePayment(in) != want {
			t.Errorf("%q", in)
		}
	}
}

func TestCalculateXP(t *testing.T) {
	cases := []struct {
		r          Rule
		amount, qt float64
		want       float64
	}{
		{rule(func(r *Rule) { r.XPMode, r.XPValue = "fixed", 7 }), 50000, 3, 7},
		{rule(func(r *Rule) { r.XPMode, r.XPValue = "per_item", 4 }), 0, 3, 12},
		{rule(func(r *Rule) { r.XPMode, r.XPValue, r.AmountStep = "per_amount", 2, 10000 }), 35000, 1, 6},
		{rule(func(r *Rule) { r.XPMode, r.XPValue = "multiplier", 0.5 }), 101, 1, 50},
		{rule(func(r *Rule) { r.XPMode, r.XPValue = "percentage", 10 }), 999, 1, 99},
		{rule(func(r *Rule) { r.XPMode, r.XPValue, r.AmountStep = "per_amount", 1, 0 }), 5, 1, 5},
		{rule(func(r *Rule) { r.XPMode, r.XPValue, r.MaxXPPerEvent = "multiplier", 1, f(100) }), 500, 1, 100},
		{rule(func(r *Rule) { r.XPMode, r.XPValue = "fixed", -5 }), 1, 1, 0},
	}
	for i, c := range cases {
		if got := CalculateXP(c.r, c.amount, c.qt); got != c.want {
			t.Errorf("case %d: got %v want %v", i, got, c.want)
		}
	}
}

func TestFindBestRule(t *testing.T) {
	now := time.Date(2026, 10, 4, 5, 0, 0, 0, time.UTC)
	future := time.Date(2026, 10, 5, 0, 0, 0, 0, time.UTC)
	past := time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC)
	rules := []Rule{
		rule(func(r *Rule) { r.ID, r.SourceType, r.SourceID = "product", "product", s("p1") }),
		rule(func(r *Rule) { r.ID, r.OutletScope, r.OutletID = "other-outlet", "specific", s("o2") }),
		rule(func(r *Rule) { r.ID, r.StartsAt = "future", &future }),
		rule(func(r *Rule) { r.ID, r.EndsAt = "expired", &past }),
		rule(func(r *Rule) { r.ID, r.MinAmount = "min", 100000 }),
		rule(func(r *Rule) { r.ID, r.OutletScope, r.OutletID = "match", "specific", s("o1") }),
		rule(func(r *Rule) { r.ID = "later" }),
	}
	in := Match{SourceType: "order_amount", OutletID: s("o1"), Amount: 50000}
	if got := FindBestRule(rules, in, now); got == nil || got.ID != "match" {
		t.Fatalf("match: %v", got)
	}
	in.Amount = 150000
	if got := FindBestRule(rules, in, now); got == nil || got.ID != "min" {
		t.Fatalf("min: %v", got)
	}
	if got := FindBestRule(rules, Match{SourceType: "product", SourceID: s("p1")}, now); got == nil || got.ID != "product" {
		t.Fatalf("product: %v", got)
	}
	if got := FindBestRule(rules, Match{SourceType: "product", SourceID: s("p2")}, now); got != nil {
		t.Fatalf("p2: %v", got)
	}
}

func TestItemAmount(t *testing.T) {
	if ItemAmount(Item{TotalAmount: f(12000), Subtotal: f(1), UnitPrice: f(1)}) != 12000 ||
		ItemAmount(Item{Subtotal: f(9000), UnitPrice: f(1)}) != 9000 ||
		ItemAmount(Item{UnitPrice: f(5000), Quantity: f(3)}) != 15000 ||
		ItemAmount(Item{UnitPrice: f(5000), Quantity: f(0)}) != 5000 {
		t.Fatal("itemAmount")
	}
}

func TestPickTierForXP(t *testing.T) {
	tiers := []Tier{{ID: "regular", Rank: 0}, {ID: "gold", Rank: 3, MinLifetimeXP: 30000}, {ID: "silver", Rank: 2, MinLifetimeXP: 10000}}
	for xp, want := range map[float64]string{0: "regular", 10000: "silver", 45000: "gold"} {
		if got := PickTierForXP(tiers, xp); got == nil || got.ID != want {
			t.Errorf("%v: %v", xp, got)
		}
	}
	if PickTierForXP([]Tier{{ID: "x", Rank: 1, MinLifetimeXP: 5}}, 1) != nil {
		t.Fatal("none")
	}
}

func TestClampXPAdjustment(t *testing.T) {
	cases := [][3]float64{{25.9, 10, 25}, {-25.9, 100, -25}, {-500, 90, -90}, {-5, 0, 0}}
	for _, c := range cases {
		if got := ClampXPAdjustment(c[0], c[1]); got != c[2] {
			t.Errorf("%v %v: %v", c[0], c[1], got)
		}
	}
}

func TestSumUnreversedEarnByOrder(t *testing.T) {
	row := func(ref string, xp float64) EarnRow {
		return EarnRow{CustomerID: "c1", MemberID: "m1", XPDelta: xp, ReferenceID: ref}
	}
	got := SumUnreversedEarnByOrder([]EarnRow{row("o1", 10), row("o1", 5), row("o2", 7), row("o3", 3)},
		map[string]bool{VoidReverseKey("o2"): true})
	if len(got) != 2 || got[0].OrderID != "o1" || got[0].XP != 15 || got[1].OrderID != "o3" || got[1].XP != 3 {
		t.Fatalf("%+v", got)
	}
}

func TestSpendTopupAndBonusXP(t *testing.T) {
	s := DefaultPosSettings()
	if CalculateSpendXP(25000, s) != 2 || CalculateSpendXP(5000, s) != 1 || CalculateSpendXP(0, s) != 0 {
		t.Fatal("spend")
	}
	if CalculateTopupXP(100000, s) != 10 {
		t.Fatal("topup per amount")
	}
	s.TopupXPMode, s.TopupXPValue = "fixed", 7.9
	if CalculateTopupXP(1, s) != 7 {
		t.Fatal("topup fixed")
	}
	bonus := map[string]float64{"p1": 5, "p2": -3}
	if got := ComputeProductBonusXP([]BonusLine{{"p1", 2.7}, {"p2", 4}, {"", 9}}, bonus); got != 10 {
		t.Fatalf("bonus %v", got)
	}
}
