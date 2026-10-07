package domain

import (
	"fmt"
	"math"
	"regexp"
	"strings"
)

/* ── cart lines (orders/order-pricing.ts) ────────────────────────────── */

// ItemQuantity is `Number(item.quantity) || 1`.
func ItemQuantity(item Obj) float64 { return Or(item.Num("quantity"), 1) }

// ItemUnitPrice is base + variant + modifier adjustments.
func ItemUnitPrice(item Obj) float64 {
	return item.NumOr0("unit_price") + item.NumOr0("variant_price_adjustment") + item.NumOr0("modifier_price_adjustment")
}

// ItemLineSubtotal is unit price × quantity.
func ItemLineSubtotal(item Obj) float64 { return ItemUnitPrice(item) * ItemQuantity(item) }

// ItemsSubtotal sums the line subtotals.
func ItemsSubtotal(items []Obj) float64 {
	sum := 0.0
	for _, it := range items {
		sum += ItemLineSubtotal(it)
	}
	return sum
}

// Discount types.
const (
	DiscountPercent = "percent"
	DiscountFixed   = "fixed"
)

// ParseDiscountType keeps "percent"/"fixed", else "" (null).
func ParseDiscountType(raw any) string {
	if s, ok := raw.(string); ok && (s == DiscountPercent || s == DiscountFixed) {
		return s
	}
	return ""
}

// ParseNullableNumber is `raw == null || raw === "" ? null : Number(raw)`.
func ParseNullableNumber(raw any) *float64 {
	if IsNullish(raw) || raw == "" {
		return nil
	}
	n := Number(raw)
	return &n
}

// LineInput is one line of the discount stack.
type LineInput struct {
	LineSubtotal  float64
	DiscountType  string
	DiscountValue *float64
}

// BuildLineInputs maps cart items to stack lines.
func BuildLineInputs(items []Obj) []LineInput {
	out := make([]LineInput, len(items))
	for i, it := range items {
		out[i] = LineInput{
			LineSubtotal:  ItemLineSubtotal(it),
			DiscountType:  ParseDiscountType(it.Get("discount_type")),
			DiscountValue: ParseNullableNumber(it.Get("discount_value")),
		}
	}
	return out
}

// TrustedTotal is resolveTrustedTotal: NFC Tab, gift card and promo orders
// always use the server total; otherwise the client total (fallback server).
func TrustedTotal(paymentMethod string, hasPromoHold bool, clientTotal any, subtotal, discount, tax, service, other float64) float64 {
	server := subtotal - discount + tax + service + other
	if paymentMethod == "nfc_tab" || paymentMethod == "gift_card" || hasPromoHold {
		return server
	}
	return Or(Number(clientTotal), server)
}

// ChangeAmount is max(0, paid + ark − total).
func ChangeAmount(paid, ark, total float64) float64 { return math.Max(0, paid+ark-total) }

// CostSnapshot is buildCostSnapshot's columns.
type CostSnapshot struct {
	CostPrice      float64
	CostTotal      float64
	GrossProfit    float64
	GrossMarginPct float64
}

// BuildCostSnapshot rounds cost and profit to cents like the TS.
func BuildCostSnapshot(costPrice, quantity, totalAmount float64) CostSnapshot {
	costPrice = ToNumber(costPrice, 0)
	costTotal := RoundHalfUp(costPrice*quantity*100) / 100
	gross := RoundHalfUp((totalAmount-costTotal)*100) / 100
	margin := 0.0
	if totalAmount > 0 {
		margin = RoundHalfUp(gross/totalAmount*10000) / 100
	}
	return CostSnapshot{CostPrice: costPrice, CostTotal: costTotal, GrossProfit: gross, GrossMarginPct: margin}
}

/* ── discount stack (manual-discount.ts) ─────────────────────────────── */

// DiscountAmount: percent floored, always capped to the basis.
func DiscountAmount(basis float64, typ string, value *float64) float64 {
	safeBasis := math.Max(0, Or0(basis))
	if typ == "" || value == nil || !Finite(*value) || *value <= 0 || safeBasis <= 0 {
		return 0
	}
	var amount float64
	if typ == DiscountPercent {
		amount = math.Floor(safeBasis * math.Min(100, *value) / 100)
	} else {
		amount = math.Floor(*value)
	}
	return math.Min(math.Max(0, amount), safeBasis)
}

// LineResult is LineDiscountResult.
type LineResult struct {
	DiscountAmount float64
	TotalAmount    float64
}

// StackInput is OrderDiscountStackInput.
type StackInput struct {
	Items         []LineInput
	OfferDiscount float64
	MembershipPct float64
	PromoDiscount float64
	ManualType    string
	ManualValue   *float64
}

// Stack is OrderDiscountStack.
type Stack struct {
	GrossSubtotal     float64
	LineDiscountTotal float64
	ItemsSubtotal     float64
	OfferAmount       float64
	MembershipAmount  float64
	PromoAmount       float64
	ManualAmount      float64
	DiscountAmount    float64
	AfterDiscount     float64
	LineResults       []LineResult
}

// ComputeDiscountStack applies item → offer → membership → promo → manual.
func ComputeDiscountStack(in StackInput) Stack {
	var s Stack
	for _, it := range in.Items {
		sub := math.Max(0, Or0(it.LineSubtotal))
		d := DiscountAmount(sub, it.DiscountType, it.DiscountValue)
		s.LineResults = append(s.LineResults, LineResult{DiscountAmount: d, TotalAmount: sub - d})
		s.GrossSubtotal += sub
		s.LineDiscountTotal += d
		s.ItemsSubtotal += sub - d
	}
	s.OfferAmount = math.Min(math.Max(0, Or0(in.OfferDiscount)), s.ItemsSubtotal)
	afterOffer := math.Max(0, s.ItemsSubtotal-s.OfferAmount)
	pct := math.Max(0, Or0(in.MembershipPct))
	if pct > 0 {
		s.MembershipAmount = math.Floor(afterOffer * pct / 100)
	}
	s.PromoAmount = math.Min(math.Max(0, Or0(in.PromoDiscount)), math.Max(0, afterOffer-s.MembershipAmount))
	basis := math.Max(0, afterOffer-s.MembershipAmount-s.PromoAmount)
	s.ManualAmount = DiscountAmount(basis, in.ManualType, in.ManualValue)
	s.DiscountAmount = s.LineDiscountTotal + s.OfferAmount + s.MembershipAmount + s.PromoAmount + s.ManualAmount
	s.AfterDiscount = math.Max(0, afterOffer-s.MembershipAmount-s.PromoAmount-s.ManualAmount)
	return s
}

// DiscountReasonInput is buildDiscountReason's input.
type DiscountReasonInput struct {
	HasItemDiscounts bool
	OfferLabels      []string
	MembershipPct    float64
	PromoCode        string
	ManualType       string
	ManualValue      *float64
}

// BuildDiscountReason joins the stack parts ("ITEM line discounts; MEMBER 5%…"); "" = null.
func BuildDiscountReason(in DiscountReasonInput) string {
	var parts []string
	if in.HasItemDiscounts {
		parts = append(parts, "ITEM line discounts")
	}
	for _, l := range in.OfferLabels {
		if t := Trim(l); t != "" {
			parts = append(parts, "OFFER "+t)
		}
	}
	if mem := Or0(in.MembershipPct); mem > 0 {
		parts = append(parts, "MEMBER "+NumberString(mem)+"%")
	}
	if code := Trim(in.PromoCode); code != "" {
		parts = append(parts, "PROMO "+strings.ToUpper(code))
	}
	if in.ManualType != "" && in.ManualValue != nil && *in.ManualValue > 0 {
		if in.ManualType == DiscountPercent {
			parts = append(parts, "MANUAL "+NumberString(*in.ManualValue)+"%")
		} else {
			parts = append(parts, "MANUAL Rp "+NumberString(math.Floor(*in.ManualValue)))
		}
	}
	return strings.Join(parts, "; ")
}

/* ── formatting (lib/format.ts, queue-number.ts) ─────────────────────── */

// FormatRupiah is formatRupiah: "Rp1.250.000", "-Rp5", rounded to rupiah.
func FormatRupiah(v float64) string {
	n := RoundHalfUp(ToNumber(v, 0))
	sign := ""
	if n < 0 {
		sign = "-"
	}
	return sign + "Rp" + groupThousands(fmt.Sprintf("%.0f", math.Abs(n)))
}

func groupThousands(digits string) string {
	if len(digits) <= 3 {
		return digits
	}
	var b strings.Builder
	head := len(digits) % 3
	if head > 0 {
		b.WriteString(digits[:head])
	}
	for i := head; i < len(digits); i += 3 {
		if b.Len() > 0 {
			b.WriteByte('.')
		}
		b.WriteString(digits[i : i+3])
	}
	return b.String()
}

// ShouldAllocateQueueNumber: blank queue number.
func ShouldAllocateQueueNumber(existing string) bool { return Trim(existing) == "" }

/* ── item SKUs (order-item-sku.ts) ───────────────────────────────────── */

var opaqueSku = regexp.MustCompile(`(?i)^(SKU-)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

// IsOpaqueSku: blank, a UUID, or "SKU-<uuid>".
func IsOpaqueSku(v string) bool {
	s := Trim(v)
	return s == "" || opaqueSku.MatchString(s)
}

// PickDisplaySku: master kode → POS sku → stored snapshot ("" = null).
func PickDisplaySku(stored, masterKode, posSku string) string {
	if m := Trim(masterKode); m != "" {
		return m
	}
	if p := Trim(posSku); p != "" && !IsOpaqueSku(p) {
		return p
	}
	if s := Trim(stored); s != "" && !IsOpaqueSku(s) {
		return s
	}
	return ""
}
