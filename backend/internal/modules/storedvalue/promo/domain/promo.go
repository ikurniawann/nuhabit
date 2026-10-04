// Package domain holds the pure promo rules (lib/promo/promo.ts,
// offer-evaluate.ts, offer-rules.ts, campaign-rules.ts): promo code
// evaluation, the offer engine, offer rule validation and the campaign
// edit plan. No database, no HTTP.
package domain

import (
	"strings"
	"unicode"

	svdomain "nuhabit/backend/internal/modules/storedvalue/domain"
)

// Eligibility values of promo_campaigns.eligibility.
const (
	EligibilityAll       = "semua"
	EligibilityMember    = "member"
	EligibilityNewMember = "member_baru"
)

// CampaignRule is the part of a promo_campaigns row the evaluator reads
// (PromoCampaignRule).
type CampaignRule struct {
	DiscountType string // "percent" | "fixed"
	Value        float64
	// MaxDiscount caps a percent discount; nil = no cap. Ignored for fixed.
	MaxDiscount *float64
	MinPurchase float64
	ValidFrom   *string // YYYY-MM-DD inclusive
	ValidUntil  *string
	// UsageLimit is the campaign-wide limit across codes; nil = unlimited.
	UsageLimit *int
	// PerPhoneLimit limits uses per WhatsApp number; nil = unlimited.
	PerPhoneLimit *int
	Scope         string // ticketing_online | ticketing_loket | pos | semua
	IsActive      bool
	// Empty = every product. The discount comes from matching lines only.
	TargetProductIDs  []string
	TargetCategoryIDs []string
	Eligibility       string // "" means semua
	NewMemberDays     *int
}

// Line is one cart line (net of line discounts).
type Line struct {
	ProductID  string
	CategoryID *string
	Amount     float64
}

// MemberContext is the buyer's history; nil = no member on the transaction.
type MemberContext struct {
	// PriorPaidOrders counts paid orders before this one (void and
	// cancelled excluded).
	PriorPaidOrders int
	// JoinedDaysAgo is the membership age in whole days.
	JoinedDaysAgo int
}

// CodeState is the promo_codes row state.
type CodeState struct {
	IsActive bool
	// UsageLimit nil = follow the campaign limit; 1 = single-use voucher.
	UsageLimit *int
	UsageCount int
}

// UsageContext is one transaction plus live counts the caller loads.
type UsageContext struct {
	Today    string // YYYY-MM-DD, Asia/Jakarta
	Channel  string // ticketing_online | ticketing_loket | pos
	Subtotal float64
	// CampaignUsedCount counts live (held/captured) redemptions across
	// every code of the campaign.
	CampaignUsedCount int
	// PhoneUsedCount counts live redemptions of the campaign for the phone.
	PhoneUsedCount int
	// Lines is required when the campaign targets products or categories.
	Lines  []Line
	Member *MemberContext
}

// RejectReason is PromoRejectReason.
type RejectReason string

// Reject reasons in evaluation order.
const (
	RejectInactive        RejectReason = "nonaktif"
	RejectNotStarted      RejectReason = "belum-mulai"
	RejectExpired         RejectReason = "kedaluwarsa"
	RejectScope           RejectReason = "scope"
	RejectMembersOnly     RejectReason = "khusus-member"
	RejectNotNewMember    RejectReason = "bukan-member-baru"
	RejectProductMismatch RejectReason = "produk-tidak-sesuai"
	RejectMinPurchase     RejectReason = "min-pembelian"
	RejectQuotaUsed       RejectReason = "kuota-habis"
	RejectPhoneLimit      RejectReason = "limit-nomor"
)

// RejectMessages are the visitor-facing rejection messages
// (PROMO_REJECT_MESSAGES).
var RejectMessages = map[RejectReason]string{
	RejectInactive:        "Kode promo tidak dikenal atau sudah tidak berlaku",
	RejectNotStarted:      "Kode promo belum mulai berlaku",
	RejectExpired:         "Kode promo sudah berakhir",
	RejectScope:           "Kode promo tidak berlaku untuk pembelian ini",
	RejectMembersOnly:     "Kode ini khusus member — pilih member dulu",
	RejectNotNewMember:    "Kode ini khusus member baru (transaksi pertama) — member ini tidak memenuhi syarat",
	RejectProductMismatch: "Kode ini hanya untuk produk/kategori tertentu — belum ada di keranjang",
	RejectMinPurchase:     "Belanja belum mencapai minimum untuk kode ini",
	RejectQuotaUsed:       "Kuota kode promo sudah habis",
	RejectPhoneLimit:      "Nomor ini sudah memakai kode promo ini",
}

// RejectLabels are the short cashier badges (PROMO_REJECT_LABELS).
var RejectLabels = map[RejectReason]string{
	RejectInactive:        "Tidak berlaku",
	RejectNotStarted:      "Belum mulai",
	RejectExpired:         "Kedaluwarsa",
	RejectScope:           "Beda kanal",
	RejectMembersOnly:     "Khusus member",
	RejectNotNewMember:    "Khusus member baru",
	RejectProductMismatch: "Produk tidak sesuai",
	RejectMinPurchase:     "Belum capai minimum",
	RejectQuotaUsed:       "Kuota habis",
	RejectPhoneLimit:      "Sudah dipakai",
}

// EvalResult is PromoEvalResult: OK with a discount, or a reason.
type EvalResult struct {
	OK       bool
	Discount float64
	Reason   RejectReason
}

// ComputeDiscount is the discount for one subtotal: percent rounds to 2
// decimals then hits MaxDiscount; fixed is taken as is. Neither exceeds
// the subtotal.
func ComputeDiscount(c CampaignRule, subtotal float64) float64 {
	discount := c.Value
	if c.DiscountType == "percent" {
		discount = svdomain.RoundIdr(subtotal * c.Value / 100)
		if c.MaxDiscount != nil {
			discount = min(discount, *c.MaxDiscount)
		}
	}
	return min(discount, subtotal)
}

// HasTargets reports whether the campaign is limited to products or
// categories.
func HasTargets(c CampaignRule) bool {
	return len(c.TargetProductIDs) > 0 || len(c.TargetCategoryIDs) > 0
}

// EligibleSubtotal is the discount base: the whole subtotal without
// targets, else the sum of lines whose product OR category is targeted.
func EligibleSubtotal(c CampaignRule, subtotal float64, lines []Line) float64 {
	if !HasTargets(c) {
		return subtotal
	}
	products := toSet(c.TargetProductIDs)
	categories := toSet(c.TargetCategoryIDs)
	base := 0.0
	for _, l := range lines {
		_, byProduct := products[l.ProductID]
		byCategory := false
		if l.CategoryID != nil {
			_, byCategory = categories[*l.CategoryID]
		}
		if byProduct || byCategory {
			base += max(0, l.Amount)
		}
	}
	return svdomain.RoundIdr(base)
}

func eligibilityReject(c CampaignRule, m *MemberContext) RejectReason {
	switch c.Eligibility {
	case "", EligibilityAll:
		return ""
	}
	if m == nil {
		return RejectMembersOnly
	}
	if c.Eligibility == EligibilityNewMember {
		if m.PriorPaidOrders > 0 {
			return RejectNotNewMember
		}
		if c.NewMemberDays != nil && m.JoinedDaysAgo > *c.NewMemberDays {
			return RejectNotNewMember
		}
	}
	return ""
}

// EvaluatePromo checks one code for one transaction in a fixed order
// (active, window, scope, member eligibility, products, minimum, quota,
// phone limit) so rejection messages stay stable.
func EvaluatePromo(c CampaignRule, code CodeState, ctx UsageContext) EvalResult {
	reject := func(r RejectReason) EvalResult { return EvalResult{Reason: r} }
	if !c.IsActive || !code.IsActive {
		return reject(RejectInactive)
	}
	if c.ValidFrom != nil && ctx.Today < *c.ValidFrom {
		return reject(RejectNotStarted)
	}
	if c.ValidUntil != nil && ctx.Today > *c.ValidUntil {
		return reject(RejectExpired)
	}
	if c.Scope != "semua" && c.Scope != ctx.Channel {
		return reject(RejectScope)
	}
	if r := eligibilityReject(c, ctx.Member); r != "" {
		return reject(r)
	}
	base := EligibleSubtotal(c, ctx.Subtotal, ctx.Lines)
	if HasTargets(c) && base <= 0 {
		return reject(RejectProductMismatch)
	}
	// A zero subtotal is never discounted.
	if ctx.Subtotal <= 0 || ctx.Subtotal < c.MinPurchase {
		return reject(RejectMinPurchase)
	}
	// The code limit is more specific: when set it wins; without it the
	// campaign limit across all its codes applies.
	if code.UsageLimit != nil {
		if code.UsageCount >= *code.UsageLimit {
			return reject(RejectQuotaUsed)
		}
	} else if c.UsageLimit != nil && ctx.CampaignUsedCount >= *c.UsageLimit {
		return reject(RejectQuotaUsed)
	}
	if c.PerPhoneLimit != nil && ctx.PhoneUsedCount >= *c.PerPhoneLimit {
		return reject(RejectPhoneLimit)
	}
	return EvalResult{OK: true, Discount: ComputeDiscount(c, base)}
}

func toSet(values []string) map[string]struct{} {
	set := make(map[string]struct{}, len(values))
	for _, v := range values {
		set[v] = struct{}{}
	}
	return set
}

// jsTrim is String.prototype.trim.
func jsTrim(s string) string {
	return strings.TrimFunc(s, func(r rune) bool { return unicode.IsSpace(r) || r == 0xFEFF })
}
