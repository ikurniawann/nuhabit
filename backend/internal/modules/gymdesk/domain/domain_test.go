package domain

import (
	"math"
	"testing"
	"time"
)

func wib(s string) time.Time {
	t, err := time.ParseInLocation("2006-01-02 15:04", s, WIB)
	if err != nil {
		panic(err)
	}
	return t
}

func TestParsePeriod(t *testing.T) {
	now := wib("2026-10-20 23:30")
	cases := []struct {
		name, from, to string
		wantFrom       string
		wantDays       int
		err            bool
	}{
		{"defaults to the last 30 days", "", "", "2026-09-21", 30, false},
		{"inclusive end day", "2026-10-01", "2026-10-07", "2026-10-01", 7, false},
		{"single day", "2026-10-05", "2026-10-05", "2026-10-05", 1, false},
		{"from without to ends today", "2026-10-19", "", "2026-10-19", 2, false},
		{"end before start", "2026-10-07", "2026-10-01", "", 0, true},
		{"too long", "2025-01-01", "2026-10-01", "", 0, true},
		{"bad date", "2026-13-01", "", "", 0, true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			p, err := ParsePeriod(c.from, c.to, now, 30, 366)
			if c.err {
				if err == nil {
					t.Fatalf("want error, got %v", p)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if got := p.From.Format("2006-01-02"); got != c.wantFrom || p.Days() != c.wantDays {
				t.Fatalf("got %s +%d days, want %s +%d", got, p.Days(), c.wantFrom, c.wantDays)
			}
		})
	}
}

func TestPreviousPeriod(t *testing.T) {
	p, _ := ParsePeriod("2026-10-08", "2026-10-14", time.Now(), 30, 366)
	prev := p.Previous()
	if prev.From.Format("2006-01-02") != "2026-10-01" || !prev.To.Equal(p.From) {
		t.Fatalf("previous = %v .. %v", prev.From, prev.To)
	}
}

func near(a, b float64) bool { return math.Abs(a-b) < 1e-9 }

func TestRollUpClasses(t *testing.T) {
	p, _ := ParsePeriod("2026-10-05", "2026-10-06", time.Now(), 30, 366)
	coach := "c1"
	name := "Maya"
	sessions := []SessionStat{
		// Monday 07:00 WIB, half full, one no-show.
		{ID: "s1", ClassTypeID: "t1", ClassTypeName: "Engine", CoachID: &coach, CoachName: &name,
			StartsAt: wib("2026-10-05 07:00"), EndsAt: wib("2026-10-05 08:00"), Capacity: 10,
			Booked: 5, CheckedIn: 4, NoShow: 1, LateCancel: 1, Bookings: 6},
		// Tuesday 07:00 WIB, full, no coach.
		{ID: "s2", ClassTypeID: "t1", ClassTypeName: "Engine",
			StartsAt: wib("2026-10-06 07:00"), EndsAt: wib("2026-10-06 08:30"), Capacity: 4,
			Booked: 4, CheckedIn: 4, Bookings: 4},
		// Still to come: left out.
		{ID: "s3", ClassTypeID: "t2", ClassTypeName: "Mobility",
			StartsAt: wib("2026-10-06 20:00"), EndsAt: wib("2026-10-06 21:00"), Capacity: 4, Booked: 2, Bookings: 2},
	}
	r := RollUpClasses(sessions, p, wib("2026-10-06 12:00"))

	if r.Totals.Sessions != 2 || r.Totals.CheckedIn != 8 || r.Totals.NoShow != 1 {
		t.Fatalf("totals = %+v", r.Totals)
	}
	if !near(r.Totals.AvgFill, 0.75) || !near(r.Totals.NoShowRate, 1.0/9) || !near(r.Totals.LateCancelRate, 0.1) {
		t.Fatalf("rates = %+v", r.Totals)
	}
	if len(r.PerDay) != 2 || r.PerDay[0].CheckedIn != 4 || r.PerDay[1].CheckedIn != 4 {
		t.Fatalf("per day = %+v", r.PerDay)
	}
	if len(r.PerClassType) != 1 || r.PerClassType[0].Sessions != 2 || !near(r.PerClassType[0].Hours, 2.5) {
		t.Fatalf("per class type = %+v", r.PerClassType)
	}
	if len(r.PerCoach) != 2 || r.PerCoach[0].Name != "Maya" || r.PerCoach[1].Name != NoCoachName {
		t.Fatalf("per coach = %+v", r.PerCoach)
	}
	if len(r.Heatmap) != 2 || r.Heatmap[0] != (HeatCell{Weekday: 1, Hour: 7, Sessions: 1, AvgFill: 0.5}) ||
		r.Heatmap[1] != (HeatCell{Weekday: 2, Hour: 7, Sessions: 1, AvgFill: 1}) {
		t.Fatalf("heatmap = %+v", r.Heatmap)
	}
}

func TestRollUpRevenue(t *testing.T) {
	p, _ := ParsePeriod("2026-10-05", "2026-10-06", time.Now(), 30, 366)
	sales := []SaleRow{
		{Day: "2026-10-05", PackageID: "p1", PackageName: "10 Kredit", Kind: "credits", Method: "cash", BranchID: "b1", BranchName: "Kemang", Sales: 2, Gross: 2_000_000},
		{Day: "2026-10-06", PackageID: "p2", PackageName: "Pass 4 Minggu", Kind: "pass", Method: "qris", Sales: 1, Gross: 1_200_000},
		{Day: "2026-10-06", PackageID: "p1", PackageName: "10 Kredit", Kind: "credits", Method: "qris", BranchID: "b1", BranchName: "Kemang", Sales: 1, Gross: 1_000_000},
	}
	refunds := []RefundRow{{Day: "2026-10-06", Count: 1, Amount: 1_000_000}}
	r := RollUpRevenue(sales, refunds, p)

	if r.Totals != (RevenueTotals{Sales: 4, Gross: 4_200_000, Refunds: 1, Refund: 1_000_000, Net: 3_200_000}) {
		t.Fatalf("totals = %+v", r.Totals)
	}
	if r.PerDay[1].Gross != 2_200_000 || r.PerDay[1].Net != 1_200_000 {
		t.Fatalf("per day = %+v", r.PerDay)
	}
	if r.PerPackage[0].Key != "p1" || r.PerPackage[0].Sales != 3 || !near(r.PerPackage[0].Share, 3.0/4.2) {
		t.Fatalf("per package = %+v", r.PerPackage)
	}
	if len(r.PerMethod) != 2 || r.PerMethod[0].Key != "qris" {
		t.Fatalf("per method = %+v", r.PerMethod)
	}
	if len(r.PerBranch) != 2 || r.PerBranch[1].Name != NoBranchName {
		t.Fatalf("per branch = %+v", r.PerBranch)
	}
}
