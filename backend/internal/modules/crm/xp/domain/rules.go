// Package domain holds the pure CRM loyalty rules (lib/crm/loyalty-rules.ts,
// the XP parts of lib/pos/loyalty-settings.ts and lib/promo/product-bonus-xp.ts).
package domain

import (
	"math"
	"sort"
	"strings"
	"time"
)

// Rule is one crm_xp_rules row as the engine reads it.
type Rule struct {
	ID                    string
	SourceType            string
	SourceID              *string
	OutletScope           string
	OutletID              *string
	XPMode                string
	XPValue               float64
	AmountStep            float64
	MinAmount             float64
	MaxXPPerEvent         *float64
	TierMultiplierEnabled bool
	StartsAt              *time.Time
	EndsAt                *time.Time
}

// Match is what a rule is matched against.
type Match struct {
	SourceType string
	SourceID   *string
	OutletID   *string
	Amount     float64
}

func strEq(a, b *string) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return *a == *b
}

// FindBestRule returns the first rule (rules are already in priority order)
// matching source, outlet, time window and minimum amount.
func FindBestRule(rules []Rule, in Match, now time.Time) *Rule {
	for i := range rules {
		r := &rules[i]
		if r.SourceType != in.SourceType || !strEq(r.SourceID, in.SourceID) {
			continue
		}
		if r.OutletScope == "specific" && !strEq(r.OutletID, in.OutletID) {
			continue
		}
		if r.StartsAt != nil && r.StartsAt.After(now) {
			continue
		}
		if r.EndsAt != nil && r.EndsAt.Before(now) {
			continue
		}
		if in.Amount < r.MinAmount {
			continue
		}
		return r
	}
	return nil
}

// CalculateXP mirrors calculateXp.
func CalculateXP(r Rule, amount, quantity float64) float64 {
	step := r.AmountStep
	if step == 0 {
		step = 1
	}
	step = math.Max(1, step)
	var xp float64
	switch r.XPMode {
	case "fixed":
		xp = r.XPValue
	case "per_item":
		xp = r.XPValue * quantity
	case "per_amount":
		xp = math.Floor(amount/step) * r.XPValue
	case "multiplier":
		xp = amount * r.XPValue
	case "percentage":
		xp = amount * (r.XPValue / 100)
	}
	if r.MaxXPPerEvent != nil {
		xp = math.Min(xp, *r.MaxXPPerEvent)
	}
	return math.Max(0, math.Floor(xp))
}

// Item is a POS order line (PosOrderItemInput). Numbers arrive as numbers or
// numeric strings in TS; callers convert with toNumber semantics.
type Item struct {
	ProductID   string
	Quantity    *float64
	TotalAmount *float64
	Subtotal    *float64
	UnitPrice   *float64
}

func orZero(p *float64) float64 {
	if p == nil {
		return 0
	}
	return *p
}

// ItemQuantity mirrors itemQuantity: at least 1.
func ItemQuantity(it Item) float64 {
	q := orZero(it.Quantity)
	if q == 0 {
		q = 1
	}
	return math.Max(1, q)
}

// ItemAmount mirrors itemAmount.
func ItemAmount(it Item) float64 {
	switch {
	case it.TotalAmount != nil:
		return *it.TotalAmount
	case it.Subtotal != nil:
		return *it.Subtotal
	}
	return orZero(it.UnitPrice) * ItemQuantity(it)
}

// IsXPEligiblePayment: spend XP only for full ARK Coin payments (EPIC-011).
func IsXPEligiblePayment(method string) bool { return strings.ToLower(method) == "ark_coin" }

// Tier is the part of crm_membership_tiers the tier pick reads.
type Tier struct {
	ID            string
	Code          string
	Rank          int
	MinLifetimeXP float64
}

// PickTierForXP returns the highest-ranked tier whose threshold lifetimeXP
// reaches, or nil.
func PickTierForXP(tiers []Tier, lifetimeXP float64) *Tier {
	sorted := append([]Tier(nil), tiers...)
	sort.SliceStable(sorted, func(i, j int) bool { return sorted[i].Rank > sorted[j].Rank })
	for i := range sorted {
		if lifetimeXP >= sorted[i].MinLifetimeXP {
			return &sorted[i]
		}
	}
	return nil
}

// ClampXPAdjustment truncates toward zero and clamps a deduction so XP
// never goes negative.
func ClampXPAdjustment(requested, current float64) float64 {
	d := math.Trunc(requested)
	if d < 0 {
		return -math.Min(-d, current)
	}
	return d
}

// VoidReverseKey is the idempotency key of a void reversal.
func VoidReverseKey(orderID string) string { return "pos:order:" + orderID + ":void_reverse" }

// EarnRow is one earn ledger row of an order.
type EarnRow struct {
	CustomerID  string
	MemberID    string
	XPDelta     float64
	OutletID    *string
	CompanyID   *string
	BranchID    *string
	ReferenceID string
}

// OrderEarn is the unreversed earn total of one order.
type OrderEarn struct {
	OrderID string
	XP      float64
	Row     EarnRow
}

// SumUnreversedEarnByOrder mirrors sumUnreversedEarnByOrder, keeping the
// first-seen order of orders (Map iteration order in TS).
func SumUnreversedEarnByOrder(rows []EarnRow, reversed map[string]bool) []OrderEarn {
	idx := map[string]int{}
	var out []OrderEarn
	for _, r := range rows {
		if reversed[VoidReverseKey(r.ReferenceID)] {
			continue
		}
		i, ok := idx[r.ReferenceID]
		if !ok {
			idx[r.ReferenceID] = len(out)
			out = append(out, OrderEarn{OrderID: r.ReferenceID, Row: r})
			i = len(out) - 1
		}
		out[i].XP += r.XPDelta
	}
	return out
}

// PosSettings are the XP parts of pos_loyalty_settings (normalized).
type PosSettings struct {
	TopupXPEnabled    bool
	TopupXPMode       string
	TopupXPValue      float64
	TopupXPAmountStep float64
	SpendXPEnabled    bool
	SpendXPAmountStep float64
	SpendXPMin        float64
}

// DefaultPosSettings mirrors DEFAULT_POS_LOYALTY_SETTINGS.
func DefaultPosSettings() PosSettings {
	return PosSettings{
		TopupXPEnabled: true, TopupXPMode: "per_amount", TopupXPValue: 1, TopupXPAmountStep: 10000,
		SpendXPEnabled: true, SpendXPAmountStep: 10000, SpendXPMin: 1,
	}
}

// CalculateTopupXP mirrors calculateTopupXp.
func CalculateTopupXP(amount float64, s PosSettings) float64 {
	if !s.TopupXPEnabled {
		return 0
	}
	amount = math.Max(0, amount)
	if amount <= 0 {
		return 0
	}
	if s.TopupXPMode == "fixed" {
		return math.Max(0, math.Floor(s.TopupXPValue))
	}
	step := math.Max(1, s.TopupXPAmountStep)
	return math.Max(0, math.Floor(amount/step)*math.Max(0, s.TopupXPValue))
}

// CalculateSpendXP mirrors calculateSpendXp.
func CalculateSpendXP(total float64, s PosSettings) float64 {
	if !s.SpendXPEnabled {
		return 0
	}
	amount := math.Max(0, total)
	if amount <= 0 {
		return 0
	}
	return math.Max(s.SpendXPMin, math.Floor(amount/math.Max(1, s.SpendXPAmountStep)))
}

// BonusLine is a line for ComputeProductBonusXP.
type BonusLine struct {
	ProductID string
	Quantity  float64
}

// ComputeProductBonusXP mirrors computeProductBonusXp: sum(floor(qty) × bonus).
func ComputeProductBonusXP(lines []BonusLine, bonus map[string]float64) float64 {
	var total float64
	for _, l := range lines {
		if l.ProductID == "" {
			continue
		}
		b := math.Max(0, math.Floor(bonus[l.ProductID]))
		total += b * math.Max(0, math.Floor(l.Quantity))
	}
	return total
}
