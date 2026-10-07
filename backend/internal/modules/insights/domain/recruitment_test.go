package domain

import (
	"encoding/json"
	"reflect"
	"testing"
	"time"
)

// Ported from lib/dashboard/recruitment.test.ts and sales-target.test.ts.

var now = time.Date(2026, 10, 4, 5, 0, 0, 0, time.UTC)

func sp(s string) *string { return &s }

func TestPeriods(t *testing.T) {
	if got := ISO(PeriodStartByDays("week", now, 30)); got != "2026-09-27T05:00:00.000Z" {
		t.Fatal(got)
	}
	if got := ISO(PeriodStartByDays("lain", now, 90)); got != "2026-07-06T05:00:00.000Z" {
		t.Fatal(got)
	}
	if m := PeriodStartByCalendar("month", now).Month(); m != time.September {
		t.Fatal(m)
	}
	if m := PeriodStartByCalendar("x", now).Month(); m != time.July {
		t.Fatal(m)
	}
	if got := ISO(PeriodStartByCalendar("week", now)); got != "2026-09-27T05:00:00.000Z" {
		t.Fatal(got)
	}
	// setMonth overflow: 31 May minus 3 months is 3 March (no 31 February).
	may31 := time.Date(2026, 5, 31, 10, 0, 0, 0, WIB)
	if got := PeriodStartByCalendar("3month", may31); got.Month() != time.March || got.Day() != 3 {
		t.Fatal(got)
	}
}

func TestSources(t *testing.T) {
	rows := []SourceStatus{
		{sp("portal"), sp("hired")},
		{sp("portal"), sp("applied")},
		{sp("referral"), sp("hired")},
		{sp("tiktok"), sp("applied")},
		{nil, sp("applied")},
	}
	var sources []*string
	for _, r := range rows {
		sources = append(sources, r.Source)
	}
	if got := SourceDistribution(sources); !reflect.DeepEqual(got, []SourceSlice{{"Website Portal", 2}, {"Referral", 1}, {"tiktok", 1}}) {
		t.Fatal(got)
	}
	want := []SourceRate{{"Website Portal", 2, 1, 50}, {"Referral", 1, 1, 100}}
	if got := SourceConversion(rows); !reflect.DeepEqual(got, want) {
		t.Fatal(got)
	}
	// analytics/sources route test: 1 of 3 hired is 33.3.
	three := []SourceStatus{{sp("jobstreet"), sp("hired")}, {sp("jobstreet"), sp("applied")}, {sp("jobstreet"), sp("applied")}}
	if got := SourceConversion(three); !reflect.DeepEqual(got, []SourceRate{{"JobStreet", 3, 1, 33.3}}) {
		t.Fatal(got)
	}
}

func TestBrandComparison(t *testing.T) {
	brands := []Brand{{"b1", "Kopi"}, {"b2", "Roti"}}
	rows := []BrandStatus{{sp("b1"), sp("hired")}, {sp("b1"), sp("talent_pool")}, {sp("b1"), sp("rejected")}, {sp("b9"), sp("applied")}}
	got := BrandComparison(brands, rows, nil)
	want := BrandComparisonResult{
		BarData: []BrandBar{{Brand: "Kopi", Applicants: 3, Active: 1, Hired: 1, InPool: 1}},
		PieData: []SourceSlice{{"Kopi", 1}},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatal(got)
	}
	if got := BrandComparison(brands, rows, sp("b2")); len(got.BarData) != 0 {
		t.Fatal(got)
	}
	b, _ := json.Marshal(BrandComparison(nil, nil, nil))
	if string(b) != `{"barData":[],"pieData":[]}` {
		t.Fatal(string(b))
	}
}

func TestFunnelAndOverview(t *testing.T) {
	stages := FunnelStages([]*string{sp("applied"), sp("applied"), sp("rejected")})
	if stages[0] != (FunnelStage{"Applied", 2}) || len(stages) != 7 {
		t.Fatal(stages)
	}
	d := func(s string) time.Time { v, _ := time.Parse("2006-01-02", s); return v }
	cands := []OverviewCandidate{
		{"1", "hired", d("2026-09-01"), d("2026-09-11"), sp("p1")},
		{"2", "applied", d("2026-09-01"), d("2026-09-01"), sp("p1")},
		{"3", "interview", d("2026-09-01"), d("2026-09-01"), sp("p2")},
		{"4", "rejected", d("2026-09-01"), d("2026-09-01"), sp("p2")},
	}
	k, per := ComputeOverviewKpis(cands)
	if *k.TimeToHireAvg != 10 || k.HiringRate != 25 || k.TotalApplicants != 4 || k.TotalHired != 1 || k.TotalRejected != 1 || k.TotalActive != 2 {
		t.Fatal(k)
	}
	for _, r := range k.ConversionRates {
		if r.Stage == "Tolak" && r.Rate != 25 {
			t.Fatal(r)
		}
	}
	got := HardToFill(per, map[string]string{"p1": "Barista"})
	want := []HardToFillPosition{{"p1", "Barista", 1}, {"p2", "Unknown", 1}}
	if !reflect.DeepEqual(got, want) {
		t.Fatal(got)
	}
	if k, _ := ComputeOverviewKpis(nil); k.TimeToHireAvg != nil {
		t.Fatal(k)
	}
}

func TestWeekly(t *testing.T) {
	weeks := LastEightWeeks(time.Date(2026, 10, 7, 12, 0, 0, 0, WIB)) // Wednesday
	if len(weeks) != 8 || weeks[7].End.Weekday() != time.Sunday || weeks[7].Start.Weekday() != time.Monday {
		t.Fatal(weeks)
	}
	if weeks[7].Label != "Sep 28" || weeks[0].Label != "Aug 10" {
		t.Fatal(weeks[7].Label, weeks[0].Label)
	}
	counts := WeeklyApplications(weeks, []time.Time{weeks[7].Start})
	if counts[7].Week != "Week 8" || counts[7].Count != 1 {
		t.Fatal(counts[7])
	}
	// The date is the UTC day of the WIB week start, as toISOString gives it.
	if counts[7].Date != "2026-09-27" {
		t.Fatal(counts[7].Date)
	}
}

func TestAttention(t *testing.T) {
	base := StaleCandidate{ID: "c", FullName: "A", Status: "screening", BrandName: sp("Kopi")}
	base.UpdatedAt = time.Date(2026, 9, 15, 5, 0, 0, 0, time.UTC)
	got := Attention(base, now)
	if got.DaysInCurrentStatus != 19 || got.Urgency != "red" || *got.BrandName != "Kopi" || got.PositionTitle != nil {
		t.Fatal(got)
	}
	base.UpdatedAt = time.Date(2026, 9, 25, 5, 0, 0, 0, time.UTC)
	if got := Attention(base, now); got.Urgency != "amber" {
		t.Fatal(got)
	}
}

func TestParseSalesTarget(t *testing.T) {
	cases := map[string]SalesTarget{
		"":       {},
		"{rusak": {},
		`{"harianRp":5000000,"bulananRp":120000000}`:   {5_000_000, 120_000_000},
		`{"harianRp":-1,"bulananRp":3000000}`:          {0, 3_000_000},
		`{"harianRp":"Rp 5.000.000"}`:                  {5_000_000, 0},
		`{"harianRp":"abc","bulananRp":1000000000000}`: {},
		`null`: {},
	}
	for raw, want := range cases {
		r := raw
		if got := ParseSalesTarget(&r); got != want {
			t.Errorf("%q: %+v", raw, got)
		}
	}
	if got := ParseSalesTarget(nil); got != (SalesTarget{}) {
		t.Fatal(got)
	}
}
