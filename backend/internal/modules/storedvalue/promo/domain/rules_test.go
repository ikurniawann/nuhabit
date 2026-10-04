package domain

import (
	"errors"
	"reflect"
	"strings"
	"testing"
)

// Ported from lib/promo/offer-rules.test.ts, offer-rules-limits.test.ts and
// campaign-rules.test.ts.

const (
	idA   = "11111111-1111-4111-8111-111111111111"
	idB   = "22222222-2222-4222-8222-222222222222"
	idC   = "33333333-3333-4333-8333-333333333333"
	catID = "33333333-3333-4333-8333-333333333333"
)

func product(role, id string, qty float64) OfferRuleItemInput {
	return OfferRuleItemInput{Role: role, ProductID: ptr(id), Qty: ptr(qty)}
}

func volumeInput(patch func(*OfferRuleInput)) OfferRuleInput {
	in := OfferRuleInput{OfferType: OfferVolume, Name: "Volume", VolumeBasis: ptr("qty"), VolumeMin: ptr(2.0),
		DiscountType: ptr("percent"), DiscountValue: ptr(10.0)}
	if patch != nil {
		patch(&in)
	}
	return in
}

func bundleInput(patch func(*OfferRuleInput)) OfferRuleInput {
	in := OfferRuleInput{OfferType: OfferBundle, Name: "Paket", BundlePrice: ptr(10.0),
		Items: []OfferRuleItemInput{product("component", idA, 1), product("component", idB, 1)}}
	if patch != nil {
		patch(&in)
	}
	return in
}

func bxgyInput(patch func(*OfferRuleInput)) OfferRuleInput {
	in := OfferRuleInput{OfferType: OfferBxgy, Name: "BOGO", BuyQty: ptr(1), GetQty: ptr(1), GetMode: ptr("same_as_buy"),
		Items: []OfferRuleItemInput{{Role: "buy", ProductID: ptr(idA)}}}
	if patch != nil {
		patch(&in)
	}
	return in
}

func TestValidateOfferRule(t *testing.T) {
	cases := []struct {
		name string
		in   OfferRuleInput
		want string // "" = valid; otherwise a substring of the message
	}{
		{"bundle tanpa nama", bundleInput(func(in *OfferRuleInput) { in.Name = "  " }), "Nama"},
		{"bundle harga 0", bundleInput(func(in *OfferRuleInput) { in.BundlePrice = ptr(0.0) }), "Harga"},
		{"bundle satu komponen", bundleInput(func(in *OfferRuleInput) { in.Items = in.Items[:1] }), "minimal 2"},
		{"bundle valid", bundleInput(func(in *OfferRuleInput) {
			in.Name, in.BundlePrice = "Paket Ayam", ptr(99000.0)
			in.ValidFrom, in.ValidUntil = ptr("2026-08-01"), ptr("2026-08-31")
			in.Items[1].Qty = ptr(2.0)
		}), ""},
		{"periode terbalik", bundleInput(func(in *OfferRuleInput) { in.ValidFrom, in.ValidUntil = ptr("2026-09-01"), ptr("2026-08-01") }), "Tanggal"},
		{"komponen kategori", bundleInput(func(in *OfferRuleInput) {
			in.BundlePrice = ptr(50_000.0)
			in.Items[1] = OfferRuleItemInput{Role: "component", CategoryID: ptr(catID), Qty: ptr(1.0)}
		}), "bukan kategori"},
		{"bxgy b1g1", bxgyInput(nil), ""},
		{"bxgy b3g1", bxgyInput(func(in *OfferRuleInput) { in.BuyQty = ptr(3) }), ""},
		{"bxgy specific tanpa get", bxgyInput(func(in *OfferRuleInput) { in.GetMode = ptr("specific_products") }), "produk gratis"},
		{"bxgy specific valid", bxgyInput(func(in *OfferRuleInput) {
			in.GetMode = ptr("specific_products")
			in.Items = append(in.Items, OfferRuleItemInput{Role: "get", ProductID: ptr(idB)}, OfferRuleItemInput{Role: "get", ProductID: ptr(idC)})
		}), ""},
		{"bxgy kategori", OfferRuleInput{OfferType: OfferBxgy, Name: "BOGO kopi", BuyQty: ptr(1), GetQty: ptr(1),
			Items: []OfferRuleItemInput{{Role: "buy", CategoryID: ptr(catID)}}}, ""},
		{"volume 5 → 3%", volumeInput(func(in *OfferRuleInput) { in.VolumeMin, in.DiscountValue = ptr(5.0), ptr(3.0) }), ""},
		{"volume min spend fixed", volumeInput(func(in *OfferRuleInput) {
			in.VolumeBasis, in.VolumeMin, in.DiscountType, in.DiscountValue = ptr("spend"), ptr(100000.0), ptr("fixed"), ptr(3000.0)
			in.Items = []OfferRuleItemInput{{Role: "eligible", ProductID: ptr(idA)}}
		}), ""},
		{"volume persen > 100", volumeInput(func(in *OfferRuleInput) { in.DiscountValue = ptr(120.0) }), "100"},
		{"volume kategori", volumeInput(func(in *OfferRuleInput) { in.Items = []OfferRuleItemInput{{Role: "eligible", CategoryID: ptr(catID)}} }), ""},
		{"baris tanpa target", volumeInput(func(in *OfferRuleInput) { in.Items = []OfferRuleItemInput{{Role: "eligible"}} }), "produk ATAU kategori"},
		{"baris dua target", volumeInput(func(in *OfferRuleInput) {
			in.Items = []OfferRuleItemInput{{Role: "eligible", ProductID: ptr(idA), CategoryID: ptr(catID)}}
		}), "produk ATAU kategori"},
		{"batas lengkap", volumeInput(func(in *OfferRuleInput) {
			in.SalesChannels = []string{"pos", "self_order"}
			in.MaxUses, in.MaxUsesPerMember, in.IsExclusive, in.Priority = ptr(100), ptr(1), ptr(true), ptr(10)
			in.UnlockCode = ptr("NGOPI-HEMAT")
			in.Items = []OfferRuleItemInput{{Role: "eligible", ProductID: ptr(idB)}}
		}), ""},
		{"channel tidak dikenal", volumeInput(func(in *OfferRuleInput) { in.SalesChannels = []string{"tokopedia"} }), "Channel"},
		{"kuota total 0", volumeInput(func(in *OfferRuleInput) { in.MaxUses = ptr(0) }), "Kuota total"},
		{"kuota member 0", volumeInput(func(in *OfferRuleInput) { in.MaxUsesPerMember = ptr(0) }), "per member"},
		{"prioritas -1", volumeInput(func(in *OfferRuleInput) { in.Priority = ptr(-1) }), "Prioritas"},
		{"prioritas 1001", volumeInput(func(in *OfferRuleInput) { in.Priority = ptr(1001) }), "Prioritas"},
		{"kode pendek", volumeInput(func(in *OfferRuleInput) { in.UnlockCode = ptr("AB") }), "Kode pembuka"},
		{"kode spasi", volumeInput(func(in *OfferRuleInput) { in.UnlockCode = ptr("KODE SPASI") }), "Kode pembuka"},
		{"kode kosong", volumeInput(func(in *OfferRuleInput) { in.UnlockCode = ptr("  ") }), ""},
	}
	for _, tc := range cases {
		got := ValidateOfferRule(tc.in)
		if (tc.want == "") != (got == "") || !strings.Contains(got, tc.want) {
			t.Errorf("%s: got %q want %q", tc.name, got, tc.want)
		}
	}
}

func TestFillUniqueCodes(t *testing.T) {
	n := 0
	gen := func() string { n++; return "K-" + string(rune('0'+n)) }
	calls := [][]string{}
	codes, err := FillUniqueCodes(2, gen, func(c []string) ([]string, error) {
		calls = append(calls, c)
		if len(calls) == 1 {
			return c[:1], nil // one collision
		}
		return c, nil
	}, func(int, int) string { return "kurang" }, 0)
	if err != nil || len(codes) != 2 || len(calls) != 2 || len(calls[1]) != 1 {
		t.Fatalf("codes %v calls %v err %v", codes, calls, err)
	}

	_, err = FillUniqueCodes(3, gen, func([]string) ([]string, error) { return nil, nil },
		func(made, need int) string { return "Hanya " + string(rune('0'+made)) + "/" + string(rune('0'+need)) }, 2)
	var short *ShortfallError
	if !errors.As(err, &short) || short.Message != "Hanya 0/3" {
		t.Fatalf("shortfall: %v", err)
	}
}

func TestInferPrefix(t *testing.T) {
	if got := InferPrefix([]string{"MERDEKA45", "pos-ab12cd", "TIX-ZZZZZZ"}); got != "POS" {
		t.Errorf("got %q", got)
	}
	if got := InferPrefix([]string{"PUBLIK"}); got != "" {
		t.Errorf("got %q", got)
	}
}

func TestGenerateVoucherCode(t *testing.T) {
	code := GenerateVoucherCode("TIX")
	if len(code) != 10 || !strings.HasPrefix(code, "TIX-") || strings.ContainsAny(code[4:], "0O1I") {
		t.Fatalf("code %q", code)
	}
}

func TestPlanCampaignUpdate(t *testing.T) {
	fresh := CampaignSnapshot{DiscountType: "percent", Value: 10}
	used := fresh
	used.CapturedCount = 3

	cols, err := PlanCampaignUpdate(CampaignPatch{IsActive: Field[bool]{true, false}, ShowInMemberPortal: Field[bool]{true, true}}, used)
	if err != nil || !reflect.DeepEqual(cols, []Column{{"is_active", false}, {"show_in_member_portal", true}}) {
		t.Fatalf("toggles: %v %v", cols, err)
	}
	var planErr *PlanError
	if _, err = PlanCampaignUpdate(CampaignPatch{Name: Field[string]{true, "Baru"}}, used); !errors.As(err, &planErr) || !planErr.Conflict {
		t.Fatalf("used campaign: %v", err)
	}
	if _, err = PlanCampaignUpdate(CampaignPatch{Value: Field[float64]{true, 150}}, fresh); err == nil || err.Error() != "Diskon persen maksimal 100" {
		t.Fatalf("percent: %v", err)
	}
	withFrom := fresh
	withFrom.ValidFrom = ptr("2026-02-01")
	if _, err = PlanCampaignUpdate(CampaignPatch{ValidUntil: Field[*string]{true, ptr("2026-01-01")}}, withFrom); err == nil || err.Error() != "Tanggal akhir sebelum tanggal mulai" {
		t.Fatalf("window: %v", err)
	}

	cols, _ = PlanCampaignUpdate(CampaignPatch{DiscountType: Field[string]{true, "fixed"}, Value: Field[float64]{true, 5000}}, fresh)
	if !reflect.DeepEqual(cols, []Column{{"discount_type", "fixed"}, {"value", 5000.0}, {"max_discount", nil}}) {
		t.Fatalf("fixed: %v", cols)
	}
	cols, _ = PlanCampaignUpdate(CampaignPatch{Eligibility: Field[string]{true, "member"}, NewMemberDays: Field[*int]{true, ptr(30)}}, fresh)
	if !reflect.DeepEqual(cols, []Column{{"eligibility", "member"}, {"new_member_days", nil}}) {
		t.Fatalf("member: %v", cols)
	}
	cols, _ = PlanCampaignUpdate(CampaignPatch{Eligibility: Field[string]{true, "member_baru"}, NewMemberDays: Field[*int]{true, ptr(30)}}, fresh)
	if len(cols) != 2 || cols[1].Name != "new_member_days" || *cols[1].Value.(*int) != 30 {
		t.Fatalf("member_baru: %v", cols)
	}
}
