package domain

import (
	"math"
	"testing"
	"time"
)

// Ported from lib/kpi/{attendance-ontime,wave2-math,targets,collect-math}.test.ts.

func weekdaySchedule() []ShiftRow {
	var rows []ShiftRow
	for dow := 1; dow <= 5; dow++ {
		id := "shift"
		rows = append(rows, ShiftRow{DayOfWeek: dow, ShiftID: &id, EffectiveFrom: "2026-01-01"})
	}
	return rows
}

func days(late ...bool) []PresentDay {
	dates := []string{"2026-07-06", "2026-07-07", "2026-07-08", "2026-07-09", "2026-07-10"}
	out := make([]PresentDay, len(late))
	for i, l := range late {
		out[i] = PresentDay{Date: dates[i], IsLate: &l}
	}
	return out
}

func TestComputeOntime(t *testing.T) {
	const start, end = "2026-07-06", "2026-07-12" // Monday to Sunday, five working days
	check := func(name string, v CollectorValue, actual *float64, sample float64) {
		t.Helper()
		if (v.Actual == nil) != (actual == nil) || (actual != nil && math.Abs(*v.Actual-*actual) > 1e-9) || v.SampleSize != sample {
			t.Errorf("%s: actual %v sample %v", name, v.Actual, v.SampleSize)
		}
	}
	f := func(x float64) *float64 { return &x }
	check("full week", ComputeOntime(weekdaySchedule(), days(false, false, false, false, false), nil, start, end), f(1), 5)
	check("late and absent", ComputeOntime(weekdaySchedule(), days(false, true, false), nil, start, end), f(0.4), 5)
	leave := ComputeOntime(weekdaySchedule(), days(false, false, false, false), map[string]bool{"2026-07-10": true}, start, end)
	check("leave", leave, f(1), 4)
	if d := leave.Detail.(OntimeDetail); d.Basis != "shift_schedule" || d.LeaveDays != 1 || d.PresentDays != 4 || d.OntimeDays != 4 {
		t.Errorf("detail %+v", d)
	}
	noSchedule := ComputeOntime(nil, days(false, true), nil, start, end)
	check("no schedule", noSchedule, f(0.5), 2)
	if noSchedule.Detail.(OntimeDetail).Basis != "attendance" {
		t.Error("basis")
	}
	check("nothing", ComputeOntime(nil, nil, nil, start, end), nil, 0)
	weekend := append(days(false), PresentDay{Date: "2026-07-11"})
	check("off day presence", ComputeOntime(weekdaySchedule(), weekend, nil, start, end), f(0.2), 5)
}

func TestLeaveDates(t *testing.T) {
	got := LeaveDates([]LeaveRange{{"2026-06-29", "2026-07-02"}, {"2026-07-31", "2026-08-03"}}, "2026-07-01", "2026-07-31")
	if len(got) != 3 || !got["2026-07-01"] || !got["2026-07-02"] || !got["2026-07-31"] {
		t.Fatal(got)
	}
}

func TestTeamOntime(t *testing.T) {
	d1, d2 := "d1", "d2"
	employees := []KPIEmployee{{ID: "a", DepartmentID: &d1}, {ID: "b", DepartmentID: &d1}, {ID: "c", DepartmentID: &d2}, {ID: "x"}}
	v := func(x float64) CollectorValue { return CollectorValue{Actual: &x} }
	got := TeamOntime(employees, map[string]CollectorValue{"a": v(1), "b": v(0.5), "c": v(0.8), "x": {}})
	if *got["a"].Actual != 0.75 || got["b"].SampleSize != 2 || *got["c"].Actual != 0.8 || len(got) != 3 {
		t.Fatalf("%+v", got)
	}
	if got := TeamOntime(employees, map[string]CollectorValue{"a": v(0.9)}); *got["b"].Actual != 0.9 || got["b"].SampleSize != 1 {
		t.Fatalf("member without data: %+v", got)
	}
	if got := TeamOntime(employees, nil); len(got) != 0 {
		t.Fatal(got)
	}
}

func TestScheduledMinutes(t *testing.T) {
	brk := func(n int) *int { return &n }
	for _, c := range []struct {
		s    ShiftDuration
		want int
	}{
		{ShiftDuration{"08:00:00", "17:00:00", brk(60), false}, 480},
		{ShiftDuration{"22:00:00", "06:00:00", brk(30), true}, 450},
		{ShiftDuration{"08:00:00", "08:00:00", brk(60), false}, 0},
		{ShiftDuration{"08:00:00", "12:30:00", nil, false}, 270},
	} {
		if got := ScheduledMinutes(c.s); got != c.want {
			t.Errorf("%+v = %d, want %d", c.s, got, c.want)
		}
	}
	shift := "s"
	ratio := LateRatio([]ShiftRow{{DayOfWeek: 1, ShiftID: &shift, EffectiveFrom: "2026-01-01"}},
		map[string]ShiftDuration{"s": {"08:00:00", "17:00:00", brk(60), false}}, 24, "2026-07-01", "2026-07-31")
	if ratio.SampleSize != 4 || *ratio.Actual != 24.0/(4*480) {
		t.Fatalf("late ratio %+v", ratio)
	}
}

func TestResolveTarget(t *testing.T) {
	s := func(v string) *string { return &v }
	i := func(v int) *int { return &v }
	f := func(v float64) *float64 { return &v }
	ctx := TargetContext{EmployeeID: "emp-1", DepartmentID: s("dept-1"), RoleCode: "pos", Month: 7, Year: 2026}
	val := func(p *float64) any {
		if p == nil {
			return nil
		}
		return *p
	}
	for name, c := range map[string]struct {
		rows []KPITarget
		ctx  TargetContext
		def  *float64
		want any
	}{
		"default":       {nil, ctx, f(0.95), 0.95},
		"no default":    {nil, ctx, nil, nil},
		"employee wins": {[]KPITarget{{Target: 1}, {RoleCode: s("pos"), Target: 2}, {DepartmentID: s("dept-1"), Target: 3}, {EmployeeID: s("emp-1"), Target: 4}}, ctx, nil, 4.0},
		"period wins":   {[]KPITarget{{RoleCode: s("pos"), Target: 2}, {RoleCode: s("pos"), PeriodYear: i(2026), PeriodMonth: i(7), Target: 5}}, ctx, nil, 5.0},
		"others ignored": {[]KPITarget{{EmployeeID: s("x"), Target: 9}, {DepartmentID: s("y"), Target: 9}, {RoleCode: s("hrd"), Target: 9},
			{PeriodYear: i(2026), PeriodMonth: i(6), RoleCode: s("pos"), Target: 9}}, ctx, f(0.9), 0.9},
		"year only":     {[]KPITarget{{RoleCode: s("pos"), Target: 1}, {RoleCode: s("pos"), PeriodYear: i(2026), Target: 2}}, ctx, nil, 2.0},
		"month only":    {[]KPITarget{{RoleCode: s("pos"), Target: 1}, {RoleCode: s("pos"), PeriodMonth: i(7), Target: 6}}, ctx, nil, 6.0},
		"scope first":   {[]KPITarget{{PeriodYear: i(2026), PeriodMonth: i(7), Target: 1}, {EmployeeID: s("emp-1"), Target: 7}}, ctx, nil, 7.0},
		"no department": {[]KPITarget{{DepartmentID: s("dept-1"), Target: 3}}, TargetContext{EmployeeID: "e", RoleCode: "pos", Month: 7, Year: 2026}, nil, nil},
	} {
		if got := val(ResolveTarget(c.rows, c.ctx, c.def)); got != c.want {
			t.Errorf("%s: %v, want %v", name, got, c.want)
		}
	}
}

func TestSafeRatio(t *testing.T) {
	if SafeRatio(1, 0) != nil || SafeRatio(1, -1) != nil || SafeRatio(math.NaN(), 1) != nil || *SafeRatio(-3, 2) != 0 || *SafeRatio(3, 2) != 1.5 {
		t.Fatal("SafeRatio")
	}
}

func TestPayrollTimeliness(t *testing.T) {
	if p, r := PayrollTimeliness(25, 2026, 6, nil); p != nil || r != nil {
		t.Fatal("no runs")
	}
	at := func(s string) *time.Time { v, _ := time.Parse(time.RFC3339, s); return &v }
	// Payday 30 clamps to 28 Feb; the deadline is 16:59:59 UTC (end of day WIB).
	paid, ready := PayrollTimeliness(30, 2026, 2, []RunTimes{
		{ApprovedAt: at("2026-02-26T16:59:59Z"), PaidAt: at("2026-02-28T16:59:59Z")},
		{ApprovedAt: at("2026-02-26T17:00:00Z"), PaidAt: at("2026-02-28T17:00:00Z")},
	})
	if *paid.Actual != 0.5 || *ready.Actual != 0.5 || paid.SampleSize != 2 || paid.Detail.(map[string]any)["paid_ontime"] != 1 {
		t.Fatalf("%+v %+v", paid, ready)
	}
}

func TestTaskCompletion(t *testing.T) {
	d := "d1"
	s := func(v string) *string { return &v }
	employees := []KPIEmployee{{ID: "a", DepartmentID: &d}, {ID: "b", DepartmentID: &d}, {ID: "c"}}
	got := TaskCompletion(employees, []TaskCount{
		{DepartmentID: d, AssigneeEmployeeID: s("a"), Status: "approved", Count: 3},
		{DepartmentID: d, AssigneeEmployeeID: s("a"), Status: "done", Count: 1},
		{DepartmentID: d, DoneBy: s("b"), Status: "approved", Count: 2},
		{DepartmentID: d, Status: "pending", Count: 2}, // nobody did it: due for every member
	})
	if *got["a"].Actual != 0.5 || got["a"].SampleSize != 6 || *got["b"].Actual != 0.5 || got["b"].SampleSize != 4 {
		t.Fatalf("%+v", got)
	}
	if _, ok := got["c"]; ok {
		t.Fatal("no tasks, no value")
	}
}
