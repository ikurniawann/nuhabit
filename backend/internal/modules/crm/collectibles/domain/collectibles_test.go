package domain

import (
	"testing"
	"time"
)

func ptr[T any](v T) *T { return &v }

// Carries collectibles.test.ts (evaluateCollectibleGate, blockerMessage,
// parseIntervalXp).
func TestEvaluateGate(t *testing.T) {
	now := time.Date(2026, 7, 25, 3, 0, 0, 0, time.UTC)
	base := Gate{IsActive: true}
	cases := []struct {
		name    string
		xp      float64
		gate    Gate
		blocker string
	}{
		{"passes every rule", 10_000, Gate{IsActive: true, MinLifetimeXP: 5_000, RequiredTierRank: ptr(1), MemberTierRank: ptr(2)}, ""},
		{"inactive", 10_000, Gate{}, "inactive"},
		{"not started", 10_000, Gate{IsActive: true, StartsAt: ptr(time.Date(2026, 8, 1, 0, 0, 0, 0, time.UTC))}, "not_started"},
		{"ended", 10_000, Gate{IsActive: true, EndsAt: ptr(time.Date(2026, 7, 1, 0, 0, 0, 0, time.UTC))}, "ended"},
		{"out of stock", 10_000, Gate{IsActive: true, StockRemaining: ptr(0)}, "out_of_stock"},
		{"below artwork XP", 4_000, Gate{IsActive: true, MinLifetimeXP: 5_000}, "below_min_xp"},
		{"older low threshold still allowed", 50_000, Gate{IsActive: true, MinLifetimeXP: 1_000}, ""},
		{"tier too low", 10_000, Gate{IsActive: true, RequiredTierRank: ptr(2), MemberTierRank: ptr(1)}, "below_tier"},
		{"no member tier", 10_000, Gate{IsActive: true, RequiredTierRank: ptr(2)}, "below_tier"},
		{"base", 0, base, ""},
	}
	for _, c := range cases {
		allowed, blocker := EvaluateGate(c.xp, c.gate, now)
		if blocker != c.blocker || allowed != (c.blocker == "") {
			t.Errorf("%s: got (%v, %q), want %q", c.name, allowed, blocker, c.blocker)
		}
	}
}

func TestBlockerMessageAndInterval(t *testing.T) {
	if got := BlockerMessage("below_min_xp", 3_500, 5_000, nil); got != "Kurang 1.500 XP lagi" {
		t.Fatalf("got %q", got)
	}
	if got := BlockerMessage("below_tier", 0, 0, ptr("Gold")); got != "Perlu tier Gold" {
		t.Fatalf("got %q", got)
	}
	cases := []struct {
		raw  any
		want int
	}{
		{"2500", 2_500}, {"abc", 5_000}, {"0", 5_000}, {5000.0, 5_000}, {2500.7, 2_500}, {nil, 5_000},
		{map[string]any{}, 5_000}, {[]any{"300"}, 300}, {true, 1},
	}
	for _, c := range cases {
		if got := ParseIntervalXP(c.raw); got != c.want {
			t.Errorf("ParseIntervalXP(%v) = %d, want %d", c.raw, got, c.want)
		}
	}
}

func TestCheckEligibility(t *testing.T) {
	now := time.Now()
	ok, reason := CheckEligibility(Eligibility{IsActive: true, MinLifetimeXP: ptr(1000), RequiredTierMinXP: ptr(3000), TotalXP: ptr(500)}, now)
	if ok || reason != "Kurang 2.500 XP lagi" {
		t.Fatalf("got %v %q", ok, reason)
	}
	ok, reason = CheckEligibility(Eligibility{IsActive: true, StockTotal: ptr(2), StockRedeemed: ptr(2)}, now)
	if ok || reason != "Stok habis" {
		t.Fatalf("got %v %q", ok, reason)
	}
	if ok, _ := CheckEligibility(Eligibility{IsActive: true, TotalXP: ptr(10)}, now); !ok {
		t.Fatal("no thresholds should pass")
	}
	if !IsCatalogID("550e8400-e29b-41d4-a716-446655440000") || IsCatalogID("x") {
		t.Fatal("catalog id")
	}
}
