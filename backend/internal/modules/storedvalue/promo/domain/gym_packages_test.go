package domain

import "testing"

func TestGymPackageTargets(t *testing.T) {
	targeted := campaign(func(c *CampaignRule) { c.Scope = "gym"; c.TargetGymPackageIDs = []string{"pkg-10", "pkg-20"} })
	every := campaign(func(c *CampaignRule) { c.Scope = "gym" })
	gym := func(pkg string) UsageContext {
		return usage(func(u *UsageContext) { u.Channel = "gym"; u.GymPackageID = pkg })
	}
	cases := []struct {
		name string
		rule CampaignRule
		ctx  UsageContext
		want EvalResult
	}{
		{"targeted package", targeted, gym("pkg-20"), ok(10_000)},
		{"other package", targeted, gym("pkg-30"), rejected(RejectPackageMismatch)},
		{"no target list takes every package", every, gym("pkg-30"), ok(10_000)},
		{"a package campaign never applies outside gym", campaign(func(c *CampaignRule) {
			c.Scope = "semua"
			c.TargetGymPackageIDs = []string{"pkg-10"}
		}), usage(func(u *UsageContext) { u.Channel = "pos" }), rejected(RejectScope)},
	}
	for _, tc := range cases {
		if got := EvaluatePromo(tc.rule, activeCode, tc.ctx); got != tc.want {
			t.Errorf("%s: got %+v want %+v", tc.name, got, tc.want)
		}
	}
	if RejectMessages[RejectPackageMismatch] == "" || RejectLabels[RejectPackageMismatch] == "" {
		t.Fatal("package mismatch needs a message and a label")
	}
}

func TestPlanCampaignUpdateGymPackages(t *testing.T) {
	cols, err := PlanCampaignUpdate(CampaignPatch{TargetGymPackages: Field[[]string]{Set: true, Value: []string{"pkg-10"}}},
		CampaignSnapshot{DiscountType: "percent", Value: 10})
	if err != nil || len(cols) != 1 || cols[0].Name != "target_gym_package_ids" {
		t.Fatalf("cols %+v err %v", cols, err)
	}
	if _, err := PlanCampaignUpdate(CampaignPatch{TargetGymPackages: Field[[]string]{Set: true, Value: []string{}}},
		CampaignSnapshot{DiscountType: "percent", Value: 10, CapturedCount: 1}); err == nil {
		t.Fatal("package targets change after a captured use")
	}
}
