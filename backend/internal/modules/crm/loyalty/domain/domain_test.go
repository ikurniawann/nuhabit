package domain

import (
	"encoding/json"
	"slices"
	"testing"
	"time"
)

func f(v float64) *float64 { return &v }

func mustTime(s string) time.Time {
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		panic(err)
	}
	return t
}

var baseReward = RewardInput{IsActive: true, RewardType: "voucher", MinXP: 5000}
var baseMember = MemberInput{TotalXP: 7000, TierRank: f(2)}

func TestEligibilityXPIsAThreshold(t *testing.T) {
	now := time.Now()
	if r := EvaluateRewardEligibility(baseReward, baseMember, now); !r.Eligible || len(r.Blockers) != 0 || r.XPNeeded != 0 {
		t.Fatalf("eligible: %+v", r)
	}
	m := baseMember
	m.TotalXP = 5000
	if !EvaluateRewardEligibility(baseReward, m, now).Eligible {
		t.Fatal("inclusive threshold")
	}
	m.TotalXP = 4200
	r := EvaluateRewardEligibility(baseReward, m, now)
	if r.Eligible || !slices.Contains(r.Blockers, "insufficient_xp") || r.XPNeeded != 800 || *r.Reason != "XP kamu belum mencukupi" {
		t.Fatalf("insufficient: %+v", r)
	}
}

func TestEligibilityQuotaStockTierPeriod(t *testing.T) {
	now := mustTime("2026-07-20T10:00:00+07:00")
	rw := baseReward
	rw.MaxRedemptionsPerMember = f(2)
	m := baseMember
	m.RedeemedInWindow = 1
	if r := EvaluateRewardEligibility(rw, m, now); !r.Eligible || *r.RemainingQuota != 1 {
		t.Fatalf("quota left: %+v", r)
	}
	m.RedeemedInWindow = 2
	if r := EvaluateRewardEligibility(rw, m, now); r.Eligible || *r.RemainingQuota != 0 || !slices.Contains(r.Blockers, "quota_exhausted") {
		t.Fatalf("quota exhausted: %+v", r)
	}
	m.RedeemedInWindow = 99
	if r := EvaluateRewardEligibility(baseReward, m, now); !r.Eligible || r.RemainingQuota != nil {
		t.Fatalf("unlimited quota: %+v", r)
	}
	rw = baseReward
	rw.StockTotal, rw.StockRedeemed = f(10), 10
	if r := EvaluateRewardEligibility(rw, baseMember, now); r.Eligible || *r.RemainingStock != 0 {
		t.Fatalf("stock: %+v", r)
	}
	rw = baseReward
	rw.RequiredTierRank = f(3)
	if r := EvaluateRewardEligibility(rw, baseMember, now); !slices.Contains(r.Blockers, "tier_too_low") {
		t.Fatalf("tier: %+v", r)
	}
	rw = baseReward
	rw.IsActive = false
	if r := EvaluateRewardEligibility(rw, baseMember, now); !slices.Contains(r.Blockers, "inactive") {
		t.Fatalf("inactive: %+v", r)
	}
	rw = baseReward
	starts := mustTime("2026-08-01T00:00:00+07:00")
	rw.StartsAt = &starts
	if r := EvaluateRewardEligibility(rw, baseMember, now); !slices.Contains(r.Blockers, "not_started") {
		t.Fatalf("not started: %+v", r)
	}
	rw = baseReward
	ends := mustTime("2026-07-01T00:00:00+07:00")
	rw.EndsAt = &ends
	if r := EvaluateRewardEligibility(rw, baseMember, now); !slices.Contains(r.Blockers, "ended") {
		t.Fatalf("ended: %+v", r)
	}
	rw = baseReward
	rw.RewardType = "avatar"
	if r := EvaluateRewardEligibility(rw, baseMember, now); r.Eligible || r.Blockers[0] != "not_redeemable" {
		t.Fatalf("avatar: %+v", r)
	}
}

func TestQuotaWindowStartFollowsWIB(t *testing.T) {
	now := mustTime("2026-07-20T15:30:00+07:00")
	cases := []struct {
		period string
		now    time.Time
		want   string
	}{
		{"daily", now, "2026-07-20T00:00:00+07:00"},
		{"monthly", now, "2026-07-01T00:00:00+07:00"},
		{"yearly", now, "2026-01-01T00:00:00+07:00"},
		{"daily", mustTime("2026-07-20T00:30:00+07:00"), "2026-07-20T00:00:00+07:00"},
		{"daily", mustTime("2026-07-20T23:59:00+07:00"), "2026-07-20T00:00:00+07:00"},
		{"monthly", mustTime("2026-08-01T00:30:00+07:00"), "2026-08-01T00:00:00+07:00"},
	}
	if QuotaWindowStart("total", now) != nil {
		t.Fatal("total has no window")
	}
	for _, c := range cases {
		got := QuotaWindowStart(c.period, c.now.UTC())
		if got == nil || !got.Equal(mustTime(c.want)) {
			t.Errorf("%s %s: got %v want %s", c.period, c.now, got, c.want)
		}
	}
}

func TestParseFeatures(t *testing.T) {
	raw := func(s string) json.RawMessage { return json.RawMessage(s) }
	if got := ParseFeatures(nil); got != (Features{true, true}) {
		t.Fatalf("defaults: %+v", got)
	}
	if got := ParseFeatures(map[string]json.RawMessage{"ark_coin_enabled": raw("false"), "xp_enabled": raw(`"true"`)}); got != (Features{false, true}) {
		t.Fatalf("mixed: %+v", got)
	}
	if got := ParseFeatures(map[string]json.RawMessage{"xp_enabled": raw(`"false"`)}); got != (Features{true, false}) {
		t.Fatalf("xp off: %+v", got)
	}
	if got := ParseFeatures(map[string]json.RawMessage{"ark_coin_enabled": raw(`{"oops":1}`)}); got != (Features{true, true}) {
		t.Fatalf("broken: %+v", got)
	}
}

func TestHumanizeLedgerDescription(t *testing.T) {
	const order = "0b6f2c1e-5d4a-4c3b-9a8e-7f6d5c4b3a21"
	sp := func(s string) *string { return &s }
	row := LedgerRow{Description: sp("XP transaksi POS — order #A-1"), ReferenceTable: sp("pos_orders"), ReferenceID: sp(order)}
	if got := HumanizeLedgerDescription(row, nil); got != "XP transaksi POS — order #A-1" {
		t.Fatal(got)
	}
	row.Description = sp("XP transaksi POS untuk order " + order)
	if got := HumanizeLedgerDescription(row, map[string]string{order: "A-77"}); got != "XP transaksi POS — order #A-77" {
		t.Fatal(got)
	}
	if got := HumanizeLedgerDescription(row, nil); got != "XP transaksi POS — order 0b6f2c1e" {
		t.Fatal(got)
	}
	topup := LedgerRow{Description: sp("XP topup ARK untuk " + order), ReferenceTable: sp("pos_wallet_transactions"), ReferenceID: sp("tx"), Amount: "50000"}
	if got := HumanizeLedgerDescription(topup, nil); got != "XP topup ARK — Rp50.000" {
		t.Fatal(got)
	}
	if got := HumanizeLedgerDescription(LedgerRow{Description: sp("Bonus " + order)}, nil); got != "Bonus 0b6f2c1e" {
		t.Fatal(got)
	}
	ids := LedgerOrderIDs([]LedgerRow{{ReferenceTable: sp("pos_orders"), ReferenceID: sp("a")}, {ReferenceTable: sp("pos_orders"), ReferenceID: sp("a")}, {ReferenceTable: sp("x"), ReferenceID: sp("b")}})
	if len(ids) != 1 || ids[0] != "a" {
		t.Fatal(ids)
	}
}
