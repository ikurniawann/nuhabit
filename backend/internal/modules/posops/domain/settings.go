package domain

import (
	"math"
	"regexp"
	"sort"
	"strings"
	"unicode/utf16"
)

// POS settings rules: receipt lines, gift card presets, the ARK & XP
// loyalty settings, the Tax & Service billing profile and payment method
// codes.

/* ── Receipt (lib/pos/receipt-settings.ts) ───────────────────────────── */

// ReceiptLines keeps strings, trimmed, non-empty, at most 6, each cut to
// 42 UTF-16 units (80 mm paper).
func ReceiptLines(raw any) []string {
	out := []string{}
	list, _ := raw.([]any)
	for _, v := range list {
		s, ok := v.(string)
		if !ok {
			continue
		}
		if s = TrimJS(s); s == "" {
			continue
		}
		if len(out) == 6 {
			break
		}
		u := utf16.Encode([]rune(s))
		if len(u) > 42 {
			s = string(utf16.Decode(u[:42]))
		}
		out = append(out, s)
	}
	return out
}

/* ── Gift card (lib/giftcard/giftcard.ts parseGiftCardConfig) ────────── */

// DefaultGiftCardPresets are the presets without a configuration.
var DefaultGiftCardPresets = []float64{50_000, 100_000, 200_000, 500_000}

// GiftCardConfig is the cashier's view of the gift card configuration.
type GiftCardConfig struct {
	Presets     []float64 `json:"presets"`
	AllowCustom bool      `json:"allow_custom"`
}

// ParseGiftCardConfig reads the stored JSON object (nil for none).
func ParseGiftCardConfig(raw any) GiftCardConfig {
	obj, _ := raw.(map[string]any)
	var presets []float64
	if list, ok := obj["presets"].([]any); ok {
		seen := map[float64]bool{}
		for _, v := range list {
			n, isNum := v.(float64)
			if !isNum || !Finite(n) || n <= 0 || seen[n] {
				continue
			}
			seen[n] = true
			presets = append(presets, n)
		}
		sort.Float64s(presets)
		if len(presets) > 12 {
			presets = presets[:12]
		}
	}
	cfg := GiftCardConfig{Presets: presets, AllowCustom: true}
	if len(presets) == 0 {
		cfg.Presets = DefaultGiftCardPresets
	}
	if b, ok := obj["allow_custom"].(bool); ok {
		cfg.AllowCustom = b
	}
	return cfg
}

/* ── Loyalty (lib/pos/loyalty-settings.ts) ───────────────────────────── */

// DefaultTopupPresets are the top-up presets without a configuration.
var DefaultTopupPresets = []float64{50000, 100000, 200000, 500000, 1000000}

// TopupPresets rounds, keeps positive amounts, de-duplicates and sorts;
// nothing usable means the defaults.
func TopupPresets(list []any) []float64 {
	seen := map[float64]bool{}
	out := []float64{}
	for _, v := range list {
		n := Round(ToNumber(v))
		if n > 0 && !seen[n] {
			seen[n] = true
			out = append(out, n)
		}
	}
	sort.Float64s(out)
	if len(out) == 0 {
		return append([]float64{}, DefaultTopupPresets...)
	}
	return out
}

/* ── Billing (lib/pos/billing-settings.ts) ───────────────────────────── */

// SystemBillingProfileID is the seeded system default profile.
const SystemBillingProfileID = "b0000000-0000-4000-8000-000000000001"

// BillingCharge is one tax, service, fee or rounding line of a profile.
type BillingCharge struct {
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

// BillingProfile is a resolved billing profile.
type BillingProfile struct {
	ID          string          `json:"id"`
	BranchID    *string         `json:"branch_id"`
	WarehouseID *string         `json:"warehouse_id"`
	Name        string          `json:"name"`
	IsActive    bool            `json:"is_active"`
	Scope       string          `json:"scope"`
	Charges     []BillingCharge `json:"charges"`
}

func strp(s string) *string { return &s }

// DefaultBillingProfile is the profile when none is stored.
func DefaultBillingProfile() BillingProfile {
	return BillingProfile{ID: SystemBillingProfileID, Name: "System Default", IsActive: true, Scope: "system", Charges: []BillingCharge{
		{ID: strp("b0000000-0000-4000-8000-000000000011"), Code: "TAX", Name: "Tax", ChargeKind: "tax", CalcMethod: "percent", Rate: 10, ApplyOrder: 200, IsEnabled: true, IsOptional: true, Base: "subtotal_after_discount"},
		{ID: strp("b0000000-0000-4000-8000-000000000012"), Code: "SERVICE", Name: "Service Charge", ChargeKind: "service", CalcMethod: "percent", ApplyOrder: 100, IsOptional: true, Base: "subtotal_after_discount"},
		{ID: strp("b0000000-0000-4000-8000-000000000013"), Code: "ROUND", Name: "Rounding", ChargeKind: "rounding", CalcMethod: "round_nearest", ApplyOrder: 900, Base: "subtotal_plus_fees"},
	}}
}

// ChargeRow is a stored pos_billing_charges row (numerics as text).
type ChargeRow struct {
	ID                                 string
	Code, Name, ChargeKind, CalcMethod *string
	Rate, Amount                       *string
	ApplyOrder                         *int
	IsEnabled, IsOptional              *bool
	Base                               *string
}

func oneOf(v string, options ...string) bool {
	for _, o := range options {
		if v == o {
			return true
		}
	}
	return false
}

// NormalizeCharge mirrors normalizeBillingCharge.
func NormalizeCharge(r ChargeRow) BillingCharge {
	id := r.ID
	code := strings.ToUpper(TrimJS(orStr(r.Code, "")))
	if code == "" {
		code = "FEE"
	}
	name := TrimJS(orStr(r.Name, orStr(r.Code, "Charge")))
	if name == "" {
		name = "Charge"
	}
	kind := strings.ToLower(orStr(r.ChargeKind, ""))
	if !oneOf(kind, "tax", "service", "fee", "rounding") {
		kind = "fee"
	}
	method := strings.ToLower(orStr(r.CalcMethod, ""))
	if !oneOf(method, "percent", "fixed", "round_nearest", "round_up") {
		method = "percent"
	}
	base := "subtotal_after_discount"
	if orStr(r.Base, "") == "subtotal_plus_fees" {
		base = "subtotal_plus_fees"
	}
	order := 100.0
	if r.ApplyOrder != nil {
		order = float64(*r.ApplyOrder)
	}
	return BillingCharge{
		ID: &id, Code: code, Name: name, ChargeKind: kind, CalcMethod: method,
		Rate: math.Max(0, numOf(r.Rate)), Amount: math.Max(0, numOf(r.Amount)), ApplyOrder: math.Floor(order),
		IsEnabled: r.IsEnabled == nil || *r.IsEnabled, IsOptional: r.IsOptional != nil && *r.IsOptional, Base: base,
	}
}

// ProfileScope is system (no branch), stall (branch and warehouse) or branch.
func ProfileScope(branchID, warehouseID *string) string {
	switch {
	case branchID == nil:
		return "system"
	case warehouseID != nil:
		return "stall"
	}
	return "branch"
}

// ChargeLine is one line of a bill preview.
type ChargeLine struct {
	Code       string   `json:"code"`
	Name       string   `json:"name"`
	Kind       string   `json:"kind"`
	Amount     float64  `json:"amount"`
	Rate       *float64 `json:"rate,omitempty"`
	CalcMethod string   `json:"calc_method"`
}

// BillCharges is calculateBillCharges' result.
type BillCharges struct {
	TaxAmount           float64      `json:"tax_amount"`
	ServiceChargeAmount float64      `json:"service_charge_amount"`
	OtherChargesAmount  float64      `json:"other_charges_amount"`
	RoundingAdjustment  float64      `json:"rounding_adjustment"`
	Total               float64      `json:"total"`
	Breakdown           []ChargeLine `json:"breakdown"`
}

// CalculateBillCharges applies the enabled charges in apply order; an
// optional charge applies only when its code is enabled.
func CalculateBillCharges(subtotal float64, charges []BillingCharge, enabledOptional []string) BillCharges {
	sub := math.Max(0, Round(orZeroFinite(subtotal)))
	enabled := map[string]bool{}
	for _, c := range enabledOptional {
		enabled[strings.ToUpper(TrimJS(c))] = true
	}
	var lines []BillingCharge
	for _, c := range charges {
		if c.IsEnabled {
			lines = append(lines, c)
		}
	}
	sort.SliceStable(lines, func(i, j int) bool {
		if lines[i].ApplyOrder != lines[j].ApplyOrder {
			return lines[i].ApplyOrder < lines[j].ApplyOrder
		}
		return LocaleCompare(lines[i].Code, lines[j].Code) < 0
	})
	res := BillCharges{Breakdown: []ChargeLine{}}
	running, fees := sub, 0.0
	for _, c := range lines {
		if c.IsOptional && !enabled[strings.ToUpper(c.Code)] {
			continue
		}
		var amount float64
		switch {
		case c.ChargeKind == "rounding":
			step := math.Max(0, Round(c.Rate))
			if step > 0 {
				target := Round(running/step) * step
				if c.CalcMethod == "round_up" {
					target = math.Ceil(running/step) * step
				}
				amount = target - running
			}
		case c.CalcMethod == "fixed":
			amount = Round(math.Max(0, c.Amount))
		default:
			base := sub
			if c.Base == "subtotal_plus_fees" {
				base = running
			}
			amount = Round(base * math.Max(0, c.Rate) / 100)
		}
		if c.ChargeKind == "rounding" {
			if amount == 0 {
				continue
			}
			res.RoundingAdjustment += amount
			running += amount
			res.Breakdown = append(res.Breakdown, ChargeLine{Code: c.Code, Name: c.Name, Kind: "rounding", Amount: amount, CalcMethod: c.CalcMethod})
			continue
		}
		if amount == 0 || (amount < 0 && c.CalcMethod != "fixed") {
			continue
		}
		running += amount
		switch c.ChargeKind {
		case "tax":
			res.TaxAmount += amount
		case "service":
			res.ServiceChargeAmount += amount
		default:
			fees += amount
		}
		line := ChargeLine{Code: c.Code, Name: c.Name, Kind: c.ChargeKind, Amount: amount, CalcMethod: c.CalcMethod}
		if c.CalcMethod == "percent" {
			rate := c.Rate
			line.Rate = &rate
		}
		res.Breakdown = append(res.Breakdown, line)
	}
	res.OtherChargesAmount = fees + res.RoundingAdjustment
	res.Total = running
	return res
}

func orZeroFinite(f float64) float64 {
	if !Finite(f) {
		return 0
	}
	return f
}

/* ── Payment methods (lib/pos/payment-methods.ts) ────────────────────── */

var (
	paymentCodePattern = regexp.MustCompile(`^[a-z0-9_-]{2,40}$`)
	nonSlug            = regexp.MustCompile(`[^a-z0-9]+`)
)

// BuiltInPaymentCodes are the codes with their own cashier flow.
var BuiltInPaymentCodes = []string{"cash", "qris", "credit_card", "ark_coin", "nfc_tab", "gift_card"}

// IsBuiltInPaymentCode reports a built-in (protected) code.
func IsBuiltInPaymentCode(code string) bool { return oneOf(code, BuiltInPaymentCodes...) }

// PaymentHandlers are the cashier flows a method may use.
var PaymentHandlers = []string{"cash", "qris", "credit", "ark_wallet", "nfc_tab", "gift_card"}

// ValidPaymentCode is /^[a-z0-9_-]{2,40}$/.
func ValidPaymentCode(code string) bool { return paymentCodePattern.MatchString(code) }

// SlugPaymentCode lower-cases, joins non-alphanumerics with "_", trims
// underscores and cuts to 40 characters.
func SlugPaymentCode(v string) string {
	s := nonSlug.ReplaceAllString(strings.ToLower(TrimJS(v)), "_")
	s = strings.Trim(s, "_")
	if len(s) > 40 {
		s = s[:40]
	}
	return s
}
