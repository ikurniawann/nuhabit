package domain

import (
	"strings"
	"testing"
)

func TestCommissionPoolMaths(t *testing.T) {
	// 10% of 12,345,678.90 class and 40% of 3,000,000 PT revenue.
	pool := ComputeCommission(12_345_678.90, 3_000_000, DefaultCommissionSettings, nil)
	if pool.ClassPoolIDR != 1_234_567.89 || pool.PtPoolIDR != 1_200_000 || pool.TotalPoolIDR != 2_434_567.89 {
		t.Fatalf("pools = %+v", pool)
	}
	if pool.AllocatedIDR != 0 || pool.RetainedIDR != 2_434_567.89 || len(pool.Lines) != 0 || pool.OverAllocated {
		t.Fatalf("empty split = %+v", pool)
	}
	custom := DefaultCommissionSettings
	custom.ClassPoolPercent, custom.PtPoolPercent = 12.5, 0
	if p := ComputeCommission(1_000_000, 1_000_000, custom, nil); p.TotalPoolIDR != 125_000 || p.PtPoolIDR != 0 {
		t.Fatalf("custom percents = %+v", p)
	}
}

func TestCommissionRoleSplitAndOverride(t *testing.T) {
	coaches := []CommissionCoach{
		{CoachID: "c", Name: "Citra", Role: RoleCoach, ClassSessions: 10},
		{CoachID: "a", Name: "Andi", Role: RoleAssistant, ClassSessions: 4, PtSessions: 1},
		{CoachID: "h", Name: "Hana", Role: RoleHeadCoach, ClassSessions: 2, PtSessions: 3},
		{CoachID: "o", Name: "Oki", Role: RoleCoach, ShareOverride: ptr(25.0), PtSessions: 2},
		{CoachID: "z", Name: "Zero", Role: RoleHeadCoach}, // taught nothing here
	}
	// Pool 1,000,000: class 10% of 6,000,000 plus PT 40% of 1,000,000.
	pool := ComputeCommission(6_000_000, 1_000_000, DefaultCommissionSettings, coaches)
	if pool.TotalPoolIDR != 1_000_000 || len(pool.Lines) != 4 {
		t.Fatalf("pool = %+v", pool)
	}
	want := []struct {
		id     string
		share  float64
		amount float64
	}{{"h", 20, 200_000}, {"c", 16, 160_000}, {"o", 25, 250_000}, {"a", 8, 80_000}}
	for i, w := range want {
		l := pool.Lines[i]
		if l.CoachID != w.id || l.SharePercent != w.share || l.GrossIDR != w.amount || l.AmountIDR != w.amount || l.AttributionPercent != 100 {
			t.Errorf("line %d = %+v, want %+v", i, l, w)
		}
	}
	if pool.AllocatedPercent != 69 || pool.AllocatedIDR != 690_000 || pool.RetainedIDR != 310_000 || pool.OverAllocated {
		t.Fatalf("totals = %+v", pool)
	}
	if l := pool.Lines[3]; l.ClassSessions != 4 || l.PtSessions != 1 || l.AllSessions != 5 {
		t.Fatalf("assistant sessions = %+v", l)
	}

	// Shares above 100% are computed for the preview but flagged.
	over := []CommissionCoach{
		{CoachID: "x", Name: "X", Role: RoleCoach, ShareOverride: ptr(60.0), ClassSessions: 1},
		{CoachID: "y", Name: "Y", Role: RoleCoach, ShareOverride: ptr(50.0), ClassSessions: 1},
	}
	p := ComputeCommission(1_000_000, 0, DefaultCommissionSettings, over)
	if !p.OverAllocated || p.AllocatedPercent != 110 || p.RetainedIDR != 0 || p.AllocatedIDR != 110_000 {
		t.Fatalf("over allocation = %+v", p)
	}
	if refusal := CheckApproval(CommissionDraft, true, p); !strings.Contains(refusal, "110.00%") {
		t.Fatalf("over allocation refusal = %q", refusal)
	}
}

func TestCommissionAttributionAcrossBranches(t *testing.T) {
	// The coach taught 3 of 12 sessions here: a quarter of the 20% share.
	coach := CommissionCoach{CoachID: "h", Name: "H", Role: RoleHeadCoach, ClassSessions: 2, PtSessions: 1, AllSessions: 12}
	pool := ComputeCommission(10_000_000, 0, DefaultCommissionSettings, []CommissionCoach{coach})
	l := pool.Lines[0]
	if l.AttributionPercent != 25 || l.GrossIDR != 50_000 || pool.AllocatedPercent != 5 || pool.RetainedIDR != 950_000 {
		t.Fatalf("attributed line = %+v pool %+v", l, pool)
	}
	// Splits round per line to the sen: a third of 20% of 100.00 is 6.67.
	coach.ClassSessions, coach.PtSessions, coach.AllSessions = 1, 0, 3
	if l := ComputeCommission(1_000, 0, DefaultCommissionSettings, []CommissionCoach{coach}).Lines[0]; l.GrossIDR != 6.67 {
		t.Fatalf("rounded gross = %v", l.GrossIDR)
	}
}

func TestCommissionDeductions(t *testing.T) {
	s := DefaultCommissionSettings
	incidents := []Incident{{ID: "1", Kind: "no_show"}, {ID: "2", Kind: "late"}, {ID: "3", Kind: "unknown_kind"}}
	cut, applied := s.DeductionFor(incidents)
	if cut != 20 || len(applied) != 3 || applied[0].Percent != 15 || applied[2].Percent != 0 {
		t.Fatalf("cut = %v %+v", cut, applied)
	}
	// Capped by the scheme maximum.
	many := []Incident{{Kind: "no_show"}, {Kind: "no_show"}, {Kind: "no_show"}, {Kind: "no_show"}}
	if cut, _ := s.DeductionFor(many); cut != 50 {
		t.Fatalf("capped cut = %v", cut)
	}
	coach := CommissionCoach{CoachID: "c", Name: "C", Role: RoleCoach, ClassSessions: 5, Incidents: incidents}
	pool := ComputeCommission(1_000_000, 0, s, []CommissionCoach{coach})
	l := pool.Lines[0]
	// Gross 16% of 100,000; 20% of it is cut and stays with the company.
	if l.GrossIDR != 16_000 || l.DeductionPercent != 20 || l.DeductionIDR != 3_200 || l.AmountIDR != 12_800 ||
		pool.AllocatedIDR != 12_800 || pool.RetainedIDR != 87_200 {
		t.Fatalf("deducted line = %+v pool %+v", l, pool)
	}
	none := CommissionSettings{DeductionPercents: map[string]float64{}, MaxDeductionPercent: 100, ShareCoachPercent: 10, ClassPoolPercent: 10}
	if l := ComputeCommission(1_000_000, 0, none, []CommissionCoach{coach}).Lines[0]; l.DeductionIDR != 0 || l.AmountIDR != 10_000 {
		t.Fatalf("no deduction rules = %+v", l)
	}
}

func TestCommissionApprovalAndPayment(t *testing.T) {
	ok := CommissionPool{AllocatedPercent: 60}
	for _, c := range []struct {
		status string
		over   bool
		want   string
	}{
		{CommissionDraft, true, ""},
		{CommissionPreview, true, ""},
		{CommissionDraft, false, "setelah bulannya berakhir"},
		{CommissionApproved, true, "sudah disetujui"},
		{CommissionPaid, true, "sudah disetujui"},
	} {
		got := CheckApproval(c.status, c.over, ok)
		if (c.want == "" && got != "") || !strings.Contains(got, c.want) {
			t.Errorf("approve %s monthOver=%v = %q, want %q", c.status, c.over, got, c.want)
		}
	}
	ref := ptr("TRF-1")
	for _, c := range []struct {
		statement, line, channel, method string
		reference                        *string
		want                             string
	}{
		{CommissionApproved, "pending", ChannelPayroll, PayByPayroll, nil, ""},
		{CommissionApproved, "pending", ChannelDirect, PayByCash, nil, ""},
		{CommissionApproved, "pending", ChannelDirect, PayByTransfer, ref, ""},
		{CommissionDraft, "pending", ChannelPayroll, PayByPayroll, nil, "Setujui statement"},
		{CommissionApproved, "paid", ChannelPayroll, PayByPayroll, nil, "sudah dibayar"},
		{CommissionApproved, "pending", ChannelPayroll, PayByCash, nil, "lewat payroll"},
		{CommissionApproved, "pending", ChannelDirect, PayByPayroll, nil, "tunai atau transfer"},
		{CommissionApproved, "pending", ChannelDirect, PayByTransfer, ptr(""), "Referensi transfer"},
	} {
		got := CheckLinePayment(c.statement, c.line, c.channel, c.method, c.reference)
		if (c.want == "" && got != "") || !strings.Contains(got, c.want) {
			t.Errorf("pay %+v = %q", c, got)
		}
	}
	if end, err := MonthEnd("2028-02"); err != nil || end != "2028-02-29" {
		t.Fatalf("month end = %s %v", end, err)
	}
}
