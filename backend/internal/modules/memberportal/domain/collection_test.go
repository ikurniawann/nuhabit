package domain

import (
	"math"
	"slices"
	"testing"
	"time"
)

func collInt(n int) *int { return &n }

func collAt(t *testing.T, s string) time.Time {
	t.Helper()
	v, err := time.Parse(time.RFC3339, s)
	if err != nil {
		t.Fatal(err)
	}
	return v
}

// Ported from lib/crm/rewards.test.ts.

var baseReward = RewardGate{IsActive: true, RewardType: "voucher", MinXP: 5000}
var baseMember = RewardMemberState{TotalXP: 7000, TierRank: collInt(2)}

func TestRewardEligibilityXPIsAGate(t *testing.T) {
	now := time.Now()
	r := EvaluateRewardEligibility(baseReward, baseMember, now)
	if !r.Eligible || len(r.Blockers) != 0 || r.XPNeeded != 0 || r.Reason != nil {
		t.Fatalf("eligible member: %+v", r)
	}
	m := baseMember
	m.TotalXP = 5000
	if !EvaluateRewardEligibility(baseReward, m, now).Eligible {
		t.Fatal("threshold is inclusive")
	}
	m.TotalXP = 4200
	r = EvaluateRewardEligibility(baseReward, m, now)
	if r.Eligible || !slices.Contains(r.Blockers, "insufficient_xp") || r.XPNeeded != 800 || *r.Reason != "XP kamu belum mencukupi" {
		t.Fatalf("short on XP: %+v", r)
	}
}

func TestRewardEligibilityQuota(t *testing.T) {
	now := time.Now()
	reward := baseReward
	reward.MaxRedemptionsPerMember = collInt(2)
	m := baseMember
	m.RedeemedInWindow = 1
	r := EvaluateRewardEligibility(reward, m, now)
	if !r.Eligible || *r.RemainingQuota != 1 {
		t.Fatalf("quota left: %+v", r)
	}
	m.RedeemedInWindow = 2
	r = EvaluateRewardEligibility(reward, m, now)
	if r.Eligible || !slices.Contains(r.Blockers, "quota_exhausted") || *r.RemainingQuota != 0 {
		t.Fatalf("quota used up: %+v", r)
	}
	m.RedeemedInWindow = 99
	r = EvaluateRewardEligibility(baseReward, m, now)
	if !r.Eligible || r.RemainingQuota != nil {
		t.Fatalf("no quota means unlimited: %+v", r)
	}
}

func TestRewardEligibilityStockTierStatusPeriod(t *testing.T) {
	now := collAt(t, "2026-07-20T10:00:00+07:00")
	reward := baseReward
	reward.StockTotal, reward.StockRedeemed = collInt(10), 10
	r := EvaluateRewardEligibility(reward, baseMember, now)
	if r.Eligible || !slices.Contains(r.Blockers, "out_of_stock") || *r.RemainingStock != 0 {
		t.Fatalf("out of stock: %+v", r)
	}

	reward = baseReward
	reward.RequiredTierRank = collInt(3)
	if r := EvaluateRewardEligibility(reward, baseMember, now); r.Eligible || !slices.Contains(r.Blockers, "tier_too_low") {
		t.Fatalf("tier too low: %+v", r)
	}

	reward = baseReward
	reward.IsActive = false
	if r := EvaluateRewardEligibility(reward, baseMember, now); r.Eligible || !slices.Contains(r.Blockers, "inactive") {
		t.Fatalf("inactive: %+v", r)
	}

	reward = baseReward
	starts := collAt(t, "2026-08-01T00:00:00+07:00")
	reward.StartsAt = &starts
	if r := EvaluateRewardEligibility(reward, baseMember, now); !slices.Contains(r.Blockers, "not_started") {
		t.Fatalf("not started: %+v", r)
	}
	reward = baseReward
	ends := collAt(t, "2026-07-01T00:00:00+07:00")
	reward.EndsAt = &ends
	if r := EvaluateRewardEligibility(reward, baseMember, now); !slices.Contains(r.Blockers, "ended") {
		t.Fatalf("ended: %+v", r)
	}
}

func TestRewardEligibilityAvatarIsNotRedeemable(t *testing.T) {
	reward := baseReward
	reward.RewardType = "avatar"
	r := EvaluateRewardEligibility(reward, baseMember, time.Now())
	if r.Eligible || !slices.Contains(r.Blockers, "not_redeemable") || *r.Reason != "Reward ini tidak bisa ditukar" {
		t.Fatalf("avatar: %+v", r)
	}
}

func TestQuotaWindowStartWIB(t *testing.T) {
	now := collAt(t, "2026-07-20T15:30:00+07:00")
	if QuotaWindowStart("total", now) != nil {
		t.Fatal("total has no window")
	}
	cases := []struct {
		period, now, want string
	}{
		{"daily", "2026-07-20T15:30:00+07:00", "2026-07-20T00:00:00+07:00"},
		{"monthly", "2026-07-20T15:30:00+07:00", "2026-07-01T00:00:00+07:00"},
		{"yearly", "2026-07-20T15:30:00+07:00", "2026-01-01T00:00:00+07:00"},
		{"daily", "2026-07-20T00:30:00+07:00", "2026-07-20T00:00:00+07:00"},
		{"daily", "2026-07-20T23:59:00+07:00", "2026-07-20T00:00:00+07:00"},
		{"monthly", "2026-08-01T00:30:00+07:00", "2026-08-01T00:00:00+07:00"},
	}
	for _, c := range cases {
		got := QuotaWindowStart(c.period, collAt(t, c.now))
		if got == nil || !got.Equal(collAt(t, c.want)) {
			t.Errorf("%s at %s = %v, want %s", c.period, c.now, got, c.want)
		}
	}
	if QuotaPeriodLabels["monthly"] != "Per bulan" {
		t.Fatal("labels")
	}
}

func TestRetryAfterSeconds(t *testing.T) {
	for d, want := range map[time.Duration]string{time.Minute: "60", 59*time.Second + time.Millisecond: "60", time.Millisecond: "1"} {
		if got := RetryAfterSeconds(d); got != want {
			t.Errorf("RetryAfterSeconds(%v) = %s, want %s", d, got, want)
		}
	}
}

// Ported from lib/crm/collectibles.test.ts.

func TestEntitlements(t *testing.T) {
	quota := []struct {
		xp, interval float64
		want         int
	}{
		{50_000, 5_000, 10}, {4_999, 5_000, 0}, {5_000, 5_000, 1},
		{50_000, 0, 0}, {50_000, -5, 0}, {math.NaN(), 5_000, 0},
	}
	for _, c := range quota {
		if got := EntitlementQuota(c.xp, c.interval); got != c.want {
			t.Errorf("EntitlementQuota(%v, %v) = %d, want %d", c.xp, c.interval, got, c.want)
		}
	}
	remaining := []struct {
		xp, interval, used float64
		want               int
	}{
		{50_000, 5_000, 3, 7}, {20_000, 5_000, 8, 0}, {50_000, 2_500, 3, 17},
		{10_000, 5_000, math.NaN(), 2}, {10_000, 5_000, -2, 2},
	}
	for _, c := range remaining {
		if got := RemainingEntitlements(c.xp, c.interval, c.used); got != c.want {
			t.Errorf("RemainingEntitlements(%v, %v, %v) = %d, want %d", c.xp, c.interval, c.used, got, c.want)
		}
	}
}

func TestCollectibleGate(t *testing.T) {
	now := collAt(t, "2026-07-25T10:00:00+07:00")
	if ok, b := EvaluateCollectibleGate(10_000, CollectibleGate{IsActive: true, MinLifetimeXP: 5_000, RequiredTierRank: collInt(1), MemberTierRank: collInt(2)}, now); !ok || b != "" {
		t.Fatalf("all conditions met: %v %q", ok, b)
	}
	starts := collAt(t, "2026-08-01T00:00:00Z")
	ends := collAt(t, "2026-07-01T00:00:00Z")
	cases := map[string]CollectibleGate{
		"inactive":     {IsActive: false},
		"not_started":  {IsActive: true, StartsAt: &starts},
		"ended":        {IsActive: true, EndsAt: &ends},
		"out_of_stock": {IsActive: true, StockRemaining: collInt(0)},
		"below_tier":   {IsActive: true, RequiredTierRank: collInt(2), MemberTierRank: collInt(1)},
	}
	for want, gate := range cases {
		if _, b := EvaluateCollectibleGate(10_000, gate, now); b != want {
			t.Errorf("blocker = %q, want %q", b, want)
		}
	}
	if _, b := EvaluateCollectibleGate(10_000, CollectibleGate{IsActive: true, RequiredTierRank: collInt(2)}, now); b != "below_tier" {
		t.Errorf("no member tier: %q", b)
	}
	if _, b := EvaluateCollectibleGate(4_000, CollectibleGate{IsActive: true, MinLifetimeXP: 5_000}, now); b != "below_min_xp" {
		t.Errorf("below min xp: %q", b)
	}
	if ok, _ := EvaluateCollectibleGate(50_000, CollectibleGate{IsActive: true, MinLifetimeXP: 1_000}, now); !ok {
		t.Error("lower thresholds stay redeemable")
	}
}

func TestCollectibleMessagesAndInterval(t *testing.T) {
	if got := CollectibleBlockerMessage("below_min_xp", 3_500, 5_000, nil); got != "Kurang 1.500 XP lagi" {
		t.Errorf("below_min_xp = %q", got)
	}
	gold := "Gold"
	if got := CollectibleBlockerMessage("below_tier", 0, 0, &gold); got != "Perlu tier Gold" {
		t.Errorf("below_tier = %q", got)
	}
	if got := CollectibleBlockerMessage("below_tier", 0, 0, nil); got != "Tier belum cukup" {
		t.Errorf("below_tier without name = %q", got)
	}
	for raw, want := range map[any]int{"2500": 2_500, "abc": 5_000, "0": 5_000, float64(7_500): 7_500, nil: 5_000, "12.9": 12} {
		if got := ParseIntervalXP(raw); got != want {
			t.Errorf("ParseIntervalXP(%v) = %d, want %d", raw, got, want)
		}
	}
}

func TestEvaluateCollectible(t *testing.T) {
	silver := "Silver"
	when := collAt(t, "2026-07-25T03:00:00Z")
	invID := "inv"
	equipped := true
	cases := []struct {
		name   string
		row    CatalogRow
		xp     float64
		locked *string
		need   float64
	}{
		{"owned", CatalogRow{InventoryID: &invID, IsEquipped: &equipped, AcquiredAt: &when, MinLifetimeXP: collInt(9_000)}, 1_000, nil, 8_000},
		{"tier threshold names the tier", CatalogRow{RequiredTierName: &silver, RequiredTierMinXP: collInt(10_000), MinLifetimeXP: collInt(2_000)}, 1_000, collStr("Perlu tier Silver"), 9_000},
		{"artwork threshold counts XP", CatalogRow{RequiredTierName: &silver, RequiredTierMinXP: collInt(1_000), MinLifetimeXP: collInt(6_500)}, 1_000, collStr("Kurang 5.500 XP lagi"), 5_500},
		{"out of stock", CatalogRow{StockTotal: collInt(2), StockRedeemed: collInt(2)}, 1_000, collStr("Stok habis"), 0},
		{"unlocked but not owned", CatalogRow{}, 1_000, collStr("Belum kamu miliki"), 0},
	}
	for _, c := range cases {
		c.row.Rarity = "mythic"
		got := EvaluateCollectible(c.row, c.xp)
		if (got.LockedReason == nil) != (c.locked == nil) || (c.locked != nil && *got.LockedReason != *c.locked) {
			t.Errorf("%s: locked_reason = %v, want %v", c.name, got.LockedReason, c.locked)
		}
		if got.XPNeeded != c.need {
			t.Errorf("%s: xp_needed = %v, want %v", c.name, got.XPNeeded, c.need)
		}
		if got.Rarity != "common" {
			t.Errorf("%s: unknown rarity = %q", c.name, got.Rarity)
		}
	}
	owned := EvaluateCollectible(cases[0].row, 0)
	if !owned.Owned || !owned.Equipped || owned.AcquiredAt == nil || *owned.AcquiredAt != "2026-07-25T03:00:00.000Z" {
		t.Errorf("owned item: %+v", owned)
	}
	if out := EvaluateCollectible(cases[3].row, 0); out.RemainingStock == nil || *out.RemainingStock != 0 {
		t.Errorf("remaining stock: %+v", out.RemainingStock)
	}
}

func collStr(s string) *string { return &s }

func TestSortCollectibles(t *testing.T) {
	items := []MemberCollectible{
		{Name: "zebra", Rarity: "common"},
		{Name: "Bunga", Rarity: "common"},
		{Name: "apel", Rarity: "common"},
		{Name: "Naga", Rarity: "legendary"},
		{Name: "Kucing", Rarity: "common", Owned: true},
		{Name: "Edisi", Rarity: "limited"},
	}
	SortCollectibles(items)
	var names []string
	for _, it := range items {
		names = append(names, it.Name)
	}
	want := []string{"Kucing", "Edisi", "Naga", "apel", "Bunga", "zebra"}
	if !slices.Equal(names, want) {
		t.Fatalf("order = %v, want %v", names, want)
	}
}

// Ported from lib/crm/badges.test.ts.

func collF64(v float64) *float64 { return &v }

func TestIsBadgeEarned(t *testing.T) {
	stats := BadgeStats{LifetimeXP: 1200, Visits: 8, SpendIdr: 450_000, StreakWeeks: 3}
	cases := []struct {
		rule BadgeRule
		want bool
	}{
		{BadgeRule{Metric: "lifetime_xp", MinLifetimeXP: collF64(1000)}, true},
		{BadgeRule{Metric: "lifetime_xp", MinLifetimeXP: collF64(1201)}, false},
		{BadgeRule{Metric: "visits", MinLifetimeXP: collF64(0), Threshold: collF64(8)}, true},
		{BadgeRule{Metric: "visits", MinLifetimeXP: collF64(0), Threshold: collF64(9)}, false},
		{BadgeRule{Metric: "spend_idr", MinLifetimeXP: collF64(0), Threshold: collF64(450000.00)}, true},
		{BadgeRule{Metric: "streak_weeks", MinLifetimeXP: collF64(0), Threshold: collF64(4)}, false},
		{BadgeRule{Metric: "manual", MinLifetimeXP: collF64(0)}, false},
	}
	for _, c := range cases {
		if got := IsBadgeEarned(c.rule, stats); got != c.want {
			t.Errorf("IsBadgeEarned(%s) = %v, want %v", c.rule.Metric, got, c.want)
		}
	}
	if _, ok := BadgeThreshold(BadgeRule{Metric: "manual"}); ok {
		t.Error("manual badges have no threshold")
	}
}

func TestLongestWeeklyStreak(t *testing.T) {
	if got := LongestWeeklyStreak([]string{"2026-09-14", "2026-08-31", "2026-09-07", "2026-09-07", "2026-09-28", "2026-10-05"}); got != 3 {
		t.Errorf("streak = %d, want 3", got)
	}
	if got := LongestWeeklyStreak([]string{"2026-09-07", "2026-09-21"}); got != 1 {
		t.Errorf("gap breaks the run: %d", got)
	}
	if got := LongestWeeklyStreak(nil); got != 0 {
		t.Errorf("no orders: %d", got)
	}
}

func TestFormatNumber(t *testing.T) {
	cases := []struct {
		v    float64
		frac int
		want string
	}{
		{1500, 0, "1.500"}, {1250000, 0, "1.250.000"}, {999, 0, "999"}, {0, 0, "0"},
		{-1500, 0, "-1.500"}, {2.5, 0, "3"}, {1234.5678, 3, "1.234,568"}, {10, 3, "10"}, {1.5, 3, "1,5"},
	}
	for _, c := range cases {
		if got := FormatNumber(c.v, c.frac); got != c.want {
			t.Errorf("FormatNumber(%v, %d) = %q, want %q", c.v, c.frac, got, c.want)
		}
	}
}
