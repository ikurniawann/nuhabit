package domain

import (
	"slices"
	"testing"
)

// Ported from lib/promo/promo.test.ts and promo-limits.test.ts.

func ptr[T any](v T) *T { return &v }

func campaign(patch func(*CampaignRule)) CampaignRule {
	c := CampaignRule{DiscountType: "percent", Value: 10, Scope: "ticketing_online", IsActive: true, PerPhoneLimit: ptr(1)}
	if patch != nil {
		patch(&c)
	}
	return c
}

func usage(patch func(*UsageContext)) UsageContext {
	u := UsageContext{Today: "2026-08-01", Channel: "ticketing_online", Subtotal: 100_000}
	if patch != nil {
		patch(&u)
	}
	return u
}

var activeCode = CodeState{IsActive: true}

func ok(d float64) EvalResult            { return EvalResult{OK: true, Discount: d} }
func rejected(r RejectReason) EvalResult { return EvalResult{Reason: r} }

func TestComputeDiscount(t *testing.T) {
	cases := []struct {
		name     string
		rule     CampaignRule
		subtotal float64
		want     float64
	}{
		{"percent dibulatkan 2dp", campaign(func(c *CampaignRule) { c.Value = 12.5 }), 99_999, 12499.88},
		{"percent kena cap max_discount", campaign(func(c *CampaignRule) { c.Value = 50; c.MaxDiscount = ptr(20_000.0) }), 100_000, 20_000},
		{"fixed tidak boleh melebihi subtotal", campaign(func(c *CampaignRule) { c.DiscountType = "fixed"; c.Value = 150_000 }), 100_000, 100_000},
		{"fixed normal", campaign(func(c *CampaignRule) { c.DiscountType = "fixed"; c.Value = 25_000 }), 100_000, 25_000},
	}
	for _, tc := range cases {
		if got := ComputeDiscount(tc.rule, tc.subtotal); got != tc.want {
			t.Errorf("%s: got %v want %v", tc.name, got, tc.want)
		}
	}
}

func TestEvaluatePromo(t *testing.T) {
	window := campaign(func(c *CampaignRule) { c.ValidFrom = ptr("2026-08-01"); c.ValidUntil = ptr("2026-08-31") })
	at := func(day string) UsageContext { return usage(func(u *UsageContext) { u.Today = day }) }
	cases := []struct {
		name string
		rule CampaignRule
		code CodeState
		ctx  UsageContext
		want EvalResult
	}{
		{"happy path percent", campaign(nil), activeCode, usage(nil), ok(10_000)},
		{"campaign nonaktif", campaign(func(c *CampaignRule) { c.IsActive = false }), activeCode, usage(nil), rejected(RejectInactive)},
		{"kode nonaktif", campaign(nil), CodeState{}, usage(nil), rejected(RejectInactive)},
		{"window awal inklusif", window, activeCode, at("2026-08-01"), ok(10_000)},
		{"window akhir inklusif", window, activeCode, at("2026-08-31"), ok(10_000)},
		{"belum mulai", window, activeCode, at("2026-07-31"), rejected(RejectNotStarted)},
		{"kedaluwarsa", window, activeCode, at("2026-09-01"), rejected(RejectExpired)},
		{"scope harus cocok", campaign(nil), activeCode, usage(func(u *UsageContext) { u.Channel = "pos" }), rejected(RejectScope)},
		{"scope semua", campaign(func(c *CampaignRule) { c.Scope = "semua" }), activeCode, usage(func(u *UsageContext) { u.Channel = "pos" }), ok(10_000)},
		{"min_purchase di bawah", campaign(func(c *CampaignRule) { c.MinPurchase = 100_000 }), activeCode, usage(func(u *UsageContext) { u.Subtotal = 99_999 }), rejected(RejectMinPurchase)},
		{"min_purchase pas", campaign(func(c *CampaignRule) { c.MinPurchase = 100_000 }), activeCode, usage(nil), ok(10_000)},
		{"voucher sekali pakai habis", campaign(nil), CodeState{IsActive: true, UsageLimit: ptr(1), UsageCount: 1}, usage(nil), rejected(RejectQuotaUsed)},
		{"voucher sekali pakai sisa", campaign(nil), CodeState{IsActive: true, UsageLimit: ptr(1)}, usage(nil), ok(10_000)},
		{"kuota campaign habis", campaign(func(c *CampaignRule) { c.UsageLimit = ptr(100) }), activeCode, usage(func(u *UsageContext) { u.CampaignUsedCount = 100 }), rejected(RejectQuotaUsed)},
		{"kuota campaign sisa", campaign(func(c *CampaignRule) { c.UsageLimit = ptr(100) }), activeCode, usage(func(u *UsageContext) { u.CampaignUsedCount = 99 }), ok(10_000)},
		{"limit kode menang atas limit campaign", campaign(func(c *CampaignRule) { c.UsageLimit = ptr(5) }), CodeState{IsActive: true, UsageLimit: ptr(10), UsageCount: 7}, usage(func(u *UsageContext) { u.CampaignUsedCount = 5 }), ok(10_000)},
		{"per_phone_limit", campaign(nil), activeCode, usage(func(u *UsageContext) { u.PhoneUsedCount = 1 }), rejected(RejectPhoneLimit)},
		{"per_phone_limit NULL bebas", campaign(func(c *CampaignRule) { c.PerPhoneLimit = nil }), activeCode, usage(func(u *UsageContext) { u.PhoneUsedCount = 9 }), ok(10_000)},
		{"subtotal 0", campaign(nil), activeCode, usage(func(u *UsageContext) { u.Subtotal = 0 }), rejected(RejectMinPurchase)},
	}
	for _, tc := range cases {
		if got := EvaluatePromo(tc.rule, tc.code, tc.ctx); got != tc.want {
			t.Errorf("%s: got %+v want %+v", tc.name, got, tc.want)
		}
	}
}

const (
	latte     = "11111111-1111-4111-8111-111111111111"
	cake      = "22222222-2222-4222-8222-222222222222"
	mug       = "33333333-3333-4333-8333-333333333333"
	coffeeCat = "c0ffee00-0000-4000-8000-000000000001"
	pastryCat = "c0ffee00-0000-4000-8000-000000000002"
)

var posLines = []Line{
	{ProductID: latte, CategoryID: ptr(coffeeCat), Amount: 40_000},
	{ProductID: cake, CategoryID: ptr(pastryCat), Amount: 30_000},
	{ProductID: mug, Amount: 80_000},
}

func posCampaign(patch func(*CampaignRule)) CampaignRule {
	c := CampaignRule{DiscountType: "percent", Value: 10, Scope: "pos", IsActive: true}
	if patch != nil {
		patch(&c)
	}
	return c
}

func posUsage(patch func(*UsageContext)) UsageContext {
	u := UsageContext{Today: "2026-10-04", Channel: "pos", Subtotal: 150_000, Lines: posLines}
	if patch != nil {
		patch(&u)
	}
	return u
}

func TestEligibleSubtotal(t *testing.T) {
	cases := []struct {
		name string
		rule CampaignRule
		want float64
	}{
		{"tanpa target", posCampaign(nil), 150_000},
		{"target produk", posCampaign(func(c *CampaignRule) { c.TargetProductIDs = []string{latte} }), 40_000},
		{"produk + kategori tanpa dobel", posCampaign(func(c *CampaignRule) {
			c.TargetProductIDs = []string{latte, mug}
			c.TargetCategoryIDs = []string{coffeeCat}
		}), 120_000},
		{"baris tanpa kategori", posCampaign(func(c *CampaignRule) { c.TargetCategoryIDs = []string{pastryCat} }), 30_000},
	}
	for _, tc := range cases {
		if got := EligibleSubtotal(tc.rule, 150_000, posLines); got != tc.want {
			t.Errorf("%s: got %v want %v", tc.name, got, tc.want)
		}
	}
}

func TestEvaluatePromoTargetsAndEligibility(t *testing.T) {
	withMember := func(prior, days int) UsageContext {
		return posUsage(func(u *UsageContext) { u.Member = &MemberContext{PriorPaidOrders: prior, JoinedDaysAgo: days} })
	}
	member := posCampaign(func(c *CampaignRule) { c.Eligibility = EligibilityMember })
	newMember := posCampaign(func(c *CampaignRule) { c.Eligibility = EligibilityNewMember })
	newMember30 := posCampaign(func(c *CampaignRule) { c.Eligibility = EligibilityNewMember; c.NewMemberDays = ptr(30) })
	cases := []struct {
		name string
		rule CampaignRule
		ctx  UsageContext
		want EvalResult
	}{
		{"persen dari baris cocok", posCampaign(func(c *CampaignRule) { c.Value = 50; c.TargetCategoryIDs = []string{coffeeCat} }), posUsage(nil), ok(20_000)},
		{"nominal dijepit ke baris", posCampaign(func(c *CampaignRule) {
			c.DiscountType = "fixed"
			c.Value = 50_000
			c.TargetProductIDs = []string{cake}
		}), posUsage(nil), ok(30_000)},
		{"tidak ada baris cocok", posCampaign(func(c *CampaignRule) { c.TargetProductIDs = []string{cake} }),
			posUsage(func(u *UsageContext) { u.Lines = posLines[:1] }), rejected(RejectProductMismatch)},
		{"bertarget tanpa data baris", posCampaign(func(c *CampaignRule) { c.Scope = "semua"; c.TargetProductIDs = []string{cake} }),
			posUsage(func(u *UsageContext) { u.Channel = "ticketing_online"; u.Lines = nil }), rejected(RejectProductMismatch)},
		{"min pembelian dibanding subtotal", posCampaign(func(c *CampaignRule) { c.MinPurchase = 100_000; c.TargetProductIDs = []string{cake} }), posUsage(nil), ok(3_000)},
		{"cap pada basis baris", posCampaign(func(c *CampaignRule) {
			c.Value = 50
			c.MaxDiscount = ptr(10_000.0)
			c.TargetProductIDs = []string{mug}
		}), posUsage(nil), ok(10_000)},
		{"semua tidak butuh member", posCampaign(nil), posUsage(nil), ok(15_000)},
		{"khusus member tanpa member", member, posUsage(nil), rejected(RejectMembersOnly)},
		{"khusus member lama lolos", member, withMember(12, 400), ok(15_000)},
		{"member baru transaksi pertama", newMember, withMember(0, 900), ok(15_000)},
		{"member baru sudah order", newMember, withMember(1, 2), rejected(RejectNotNewMember)},
		{"member baru batas hari pas", newMember30, withMember(0, 30), ok(15_000)},
		{"member baru lewat batas hari", newMember30, withMember(0, 31), rejected(RejectNotNewMember)},
		{"member baru tanpa member", newMember, posUsage(nil), rejected(RejectMembersOnly)},
		{"kelayakan sebelum min pembelian", posCampaign(func(c *CampaignRule) { c.Eligibility = EligibilityMember; c.MinPurchase = 1_000_000 }), posUsage(nil), rejected(RejectMembersOnly)},
	}
	for _, tc := range cases {
		if got := EvaluatePromo(tc.rule, activeCode, tc.ctx); got != tc.want {
			t.Errorf("%s: got %+v want %+v", tc.name, got, tc.want)
		}
	}
}

func TestRejectMessagesAndLabelsCoverEveryReason(t *testing.T) {
	var msgs, labels []string
	for r := range RejectMessages {
		msgs = append(msgs, string(r))
		if RejectLabels[r] == "" {
			t.Errorf("no label for %s", r)
		}
	}
	for r := range RejectLabels {
		labels = append(labels, string(r))
	}
	slices.Sort(msgs)
	slices.Sort(labels)
	if !slices.Equal(msgs, labels) {
		t.Fatalf("messages %v labels %v", msgs, labels)
	}
}
