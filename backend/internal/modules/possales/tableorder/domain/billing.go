package domain

import (
	"math"
	"sort"
	"strings"
)

// Charge is BillingCharge (lib/pos/billing-settings.ts), in its JSON key
// order. ID is nil for a row without one.
type Charge struct {
	ID         *string `json:"id"`
	Code       string  `json:"code"`
	Name       string  `json:"name"`
	ChargeKind string  `json:"charge_kind"`
	CalcMethod string  `json:"calc_method"`
	Rate       float64 `json:"rate"`
	Amount     float64 `json:"amount"`
	ApplyOrder float64 `json:"apply_order"`
	IsEnabled  bool    `json:"is_enabled"`
	IsOptional bool    `json:"is_optional"`
	Base       string  `json:"base"`
}

// BreakdownLine is ChargeBreakdownLine; Rate is set for percent charges only.
type BreakdownLine struct {
	Code       string   `json:"code"`
	Name       string   `json:"name"`
	Kind       string   `json:"kind"`
	Amount     float64  `json:"amount"`
	Rate       *float64 `json:"rate,omitempty"`
	CalcMethod string   `json:"calc_method"`
}

// Bill is BillChargesResult.
type Bill struct {
	TaxAmount           float64
	ServiceChargeAmount float64
	OtherChargesAmount  float64
	RoundingAdjustment  float64
	Total               float64
	Breakdown           []BreakdownLine
}

// DefaultProfileName and DefaultCharges are DEFAULT_BILLING_PROFILE.
const DefaultProfileName = "System Default"

func ptr(s string) *string { return &s }

// DefaultCharges returns a fresh copy of DEFAULT_BILLING_CHARGES.
func DefaultCharges() []Charge {
	return []Charge{
		{ID: ptr("b0000000-0000-4000-8000-000000000011"), Code: "TAX", Name: "Tax", ChargeKind: "tax", CalcMethod: "percent", Rate: 10, ApplyOrder: 200, IsEnabled: true, IsOptional: true, Base: "subtotal_after_discount"},
		{ID: ptr("b0000000-0000-4000-8000-000000000012"), Code: "SERVICE", Name: "Service Charge", ChargeKind: "service", CalcMethod: "percent", ApplyOrder: 100, IsOptional: true, Base: "subtotal_after_discount"},
		{ID: ptr("b0000000-0000-4000-8000-000000000013"), Code: "ROUND", Name: "Rounding", ChargeKind: "rounding", CalcMethod: "round_nearest", ApplyOrder: 900, Base: "subtotal_plus_fees"},
	}
}

// ChargeRow is one pos_billing_charges row as read (nil = NULL; numbers are
// numeric columns, booleans may be NULL).
type ChargeRow struct {
	ID         *string
	Code       *string
	Name       *string
	ChargeKind *string
	CalcMethod *string
	Rate       *float64
	Amount     *float64
	ApplyOrder *float64
	IsEnabled  *bool
	IsOptional *bool
	Base       *string
}

// NormalizeCharge is normalizeBillingCharge.
func NormalizeCharge(r ChargeRow) Charge {
	code := strings.ToUpper(JSTrim(strOr(r.Code)))
	name := strOr(r.Name)
	if name == "" {
		name = strOr(r.Code)
	}
	if name == "" {
		name = "Charge"
	}
	c := Charge{
		ID:         r.ID,
		Code:       orDefault(code, "FEE"),
		Name:       orDefault(JSTrim(name), "Charge"),
		ChargeKind: "fee",
		CalcMethod: "percent",
		Rate:       math.Max(0, numOr(r.Rate)),
		Amount:     math.Max(0, numOr(r.Amount)),
		ApplyOrder: math.Floor(numOr(r.ApplyOrder)), // Number(null) is 0
		IsEnabled:  r.IsEnabled == nil || *r.IsEnabled,
		IsOptional: r.IsOptional != nil && *r.IsOptional,
		Base:       "subtotal_after_discount",
	}
	switch k := strings.ToLower(strOr(r.ChargeKind)); k {
	case "tax", "service", "fee", "rounding":
		c.ChargeKind = k
	}
	switch m := strings.ToLower(strOr(r.CalcMethod)); m {
	case "percent", "fixed", "round_nearest", "round_up":
		c.CalcMethod = m
	}
	if strOr(r.Base) == "subtotal_plus_fees" {
		c.Base = "subtotal_plus_fees"
	}
	return c
}

// lineAmount is calcLineAmount.
func lineAmount(c Charge, subtotal, running float64) float64 {
	if c.ChargeKind == "rounding" {
		step := math.Max(0, JSRound(c.Rate))
		if step <= 0 {
			return 0
		}
		target := JSRound(running/step) * step
		if c.CalcMethod == "round_up" {
			target = math.Ceil(running/step) * step
		}
		return target - running
	}
	if c.CalcMethod == "fixed" {
		return JSRound(math.Max(0, c.Amount))
	}
	base := subtotal
	if c.Base == "subtotal_plus_fees" {
		base = running
	}
	return JSRound(base * math.Max(0, c.Rate) / 100)
}

// CalculateBill is calculateBillCharges without enabled optional codes (the
// self-order route passes none): enabled charges in apply_order then code
// order, optional ones skipped.
func CalculateBill(subtotalAfterDiscount float64, charges []Charge) Bill {
	subtotal := math.Max(0, JSRound(subtotalAfterDiscount))
	lines := make([]Charge, 0, len(charges))
	for _, c := range charges {
		if c.IsEnabled {
			lines = append(lines, c)
		}
	}
	sort.SliceStable(lines, func(i, j int) bool {
		if lines[i].ApplyOrder != lines[j].ApplyOrder {
			return lines[i].ApplyOrder < lines[j].ApplyOrder
		}
		return lines[i].Code < lines[j].Code
	})

	bill := Bill{Breakdown: []BreakdownLine{}}
	running := subtotal
	fees := 0.0
	for _, c := range lines {
		if c.IsOptional {
			continue
		}
		amount := lineAmount(c, subtotal, running)
		if c.ChargeKind == "rounding" {
			if amount == 0 {
				continue
			}
			bill.RoundingAdjustment += amount
			running += amount
			bill.Breakdown = append(bill.Breakdown, BreakdownLine{Code: c.Code, Name: c.Name, Kind: "rounding", Amount: amount, CalcMethod: c.CalcMethod})
			continue
		}
		if amount == 0 || (amount < 0 && c.CalcMethod != "fixed") {
			continue
		}
		running += amount
		switch c.ChargeKind {
		case "tax":
			bill.TaxAmount += amount
		case "service":
			bill.ServiceChargeAmount += amount
		default:
			fees += amount
		}
		line := BreakdownLine{Code: c.Code, Name: c.Name, Kind: c.ChargeKind, Amount: amount, CalcMethod: c.CalcMethod}
		if c.CalcMethod == "percent" {
			rate := c.Rate
			line.Rate = &rate
		}
		bill.Breakdown = append(bill.Breakdown, line)
	}
	bill.OtherChargesAmount = fees + bill.RoundingAdjustment
	bill.Total = running
	return bill
}

// MemberDiscountAmount is memberDiscountAmount (lib/pos/member-price.ts):
// floor(amount × percent / 100) with percent clamped to 0..100.
func MemberDiscountAmount(amount, percent float64) float64 {
	pct := math.Min(100, math.Max(0, percent))
	basis := math.Max(0, amount)
	if pct <= 0 {
		return 0
	}
	return math.Floor(basis * pct / 100)
}

// Tier is a crm_membership_tiers row (rank order).
type Tier struct {
	MinLifetimeXP   float64
	DiscountPercent float64
}

// TierDiscountPercent is loadMemberDiscountPercent's rule: the highest tier
// whose min_lifetime_xp ≤ xp (the first tier below every threshold), its
// discount clamped to 0..100; 0 without tiers.
func TierDiscountPercent(tiers []Tier, totalXP float64) float64 {
	if len(tiers) == 0 {
		return 0
	}
	tier := tiers[0]
	for i := len(tiers) - 1; i >= 0; i-- {
		if totalXP >= tiers[i].MinLifetimeXP {
			tier = tiers[i]
			break
		}
	}
	return math.Min(100, math.Max(0, tier.DiscountPercent))
}
