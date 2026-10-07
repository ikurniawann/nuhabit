// Package domain holds the pure CRM loyalty catalog rules: reward
// eligibility and quota windows (lib/crm/rewards.ts) and the loyalty feature
// flags (lib/crm/loyalty-features.ts).
package domain

import (
	"math"
	"time"
)

// QuotaPeriods are the allowed quota_period values in schema order.
var QuotaPeriods = []string{"total", "daily", "monthly", "yearly"}

// ActiveRedemptionStatuses still consume quota and stock.
var ActiveRedemptionStatuses = []string{"pending", "approved", "fulfilled"}

var wib = time.FixedZone("WIB", 7*3600)

// QuotaWindowStart is the start of the quota window as an instant; nil for
// "total". Calendar boundaries follow WIB whatever the host zone.
func QuotaWindowStart(period string, now time.Time) *time.Time {
	if period == "total" {
		return nil
	}
	w := now.In(wib)
	month, day := w.Month(), w.Day()
	if period == "yearly" {
		month = time.January
	}
	if period != "daily" {
		day = 1
	}
	t := time.Date(w.Year(), month, day, 0, 0, 0, 0, wib)
	return &t
}

// RewardInput is the reward side of the eligibility check.
type RewardInput struct {
	IsActive                bool
	RewardType              string
	MinXP                   float64
	RequiredTierRank        *float64
	StockTotal              *float64
	StockRedeemed           float64
	MaxRedemptionsPerMember *float64
	StartsAt                *time.Time
	EndsAt                  *time.Time
}

// MemberInput is the member side of the eligibility check.
type MemberInput struct {
	TotalXP          float64
	TierRank         *float64
	RedeemedInWindow float64
}

// Eligibility mirrors EligibilityResult.
type Eligibility struct {
	Eligible       bool     `json:"eligible"`
	Blockers       []string `json:"blockers"`
	Reason         *string  `json:"reason"`
	XPNeeded       float64  `json:"xp_needed"`
	RemainingStock *float64 `json:"remaining_stock"`
	RemainingQuota *float64 `json:"remaining_quota"`
}

var blockerMessages = map[string]string{
	"not_redeemable":  "Reward ini tidak bisa ditukar",
	"inactive":        "Reward sedang tidak tersedia",
	"not_started":     "Periode reward belum dimulai",
	"ended":           "Periode reward sudah berakhir",
	"out_of_stock":    "Stok reward habis",
	"insufficient_xp": "XP kamu belum mencukupi",
	"tier_too_low":    "Tier kamu belum memenuhi syarat",
	"quota_exhausted": "Jatah redeem kamu untuk reward ini sudah habis",
}

// EvaluateRewardEligibility mirrors evaluateRewardEligibility: min_xp is a
// threshold, never a cost.
func EvaluateRewardEligibility(r RewardInput, m MemberInput, now time.Time) Eligibility {
	blockers := []string{}
	if r.RewardType == "avatar" {
		blockers = append(blockers, "not_redeemable")
	}
	if !r.IsActive {
		blockers = append(blockers, "inactive")
	}
	if r.StartsAt != nil && now.Before(*r.StartsAt) {
		blockers = append(blockers, "not_started")
	}
	if r.EndsAt != nil && now.After(*r.EndsAt) {
		blockers = append(blockers, "ended")
	}
	var remainingStock *float64
	if r.StockTotal != nil {
		v := math.Max(0, *r.StockTotal-r.StockRedeemed)
		remainingStock = &v
		if v <= 0 {
			blockers = append(blockers, "out_of_stock")
		}
	}
	needed := math.Max(0, math.Max(0, r.MinXP)-m.TotalXP)
	if needed > 0 {
		blockers = append(blockers, "insufficient_xp")
	}
	if r.RequiredTierRank != nil {
		rank := 0.0
		if m.TierRank != nil {
			rank = *m.TierRank
		}
		if rank < *r.RequiredTierRank {
			blockers = append(blockers, "tier_too_low")
		}
	}
	var remainingQuota *float64
	if r.MaxRedemptionsPerMember != nil {
		v := math.Max(0, *r.MaxRedemptionsPerMember-m.RedeemedInWindow)
		remainingQuota = &v
		if v <= 0 {
			blockers = append(blockers, "quota_exhausted")
		}
	}
	out := Eligibility{
		Eligible: len(blockers) == 0, Blockers: blockers, XPNeeded: needed,
		RemainingStock: remainingStock, RemainingQuota: remainingQuota,
	}
	if len(blockers) > 0 {
		msg := blockerMessages[blockers[0]]
		out.Reason = &msg
	}
	return out
}
