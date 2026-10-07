package domain

import (
	"math"
	"sort"
	"strconv"
	"strings"
	"time"
)

// KPI collectors (lib/kpi/collectors.ts, collectors-wave2.ts and their
// pure helpers): each turns raw records into an actual value per employee
// (or one value for the organisation) for the monthly snapshot.

// CollectorValue is one collected measurement: Actual nil excludes the
// indicator from the score; Detail is stored as source_detail for audit.
type CollectorValue struct {
	Actual     *float64
	SampleSize float64
	Detail     any
}

// SafeRatio is safeRatio: nil when the denominator is not positive (not
// enough data), a negative numerator clamps to 0, ratios may exceed 1.
func SafeRatio(num, den float64) *float64 {
	if !Finite(num) || !Finite(den) || den <= 0 {
		return nil
	}
	v := math.Max(0, num) / den
	return &v
}

// KPIEmployee is an active employee with its account's role ("employee"
// without an account).
type KPIEmployee struct {
	ID           string
	UserID       *string
	DepartmentID *string
	RoleCode     string
}

// PresentDay is an attendance row with status present.
type PresentDay struct {
	Date   string
	IsLate *bool
}

// OntimeDetail is computeOntime's detail.
type OntimeDetail struct {
	Basis         string `json:"basis"`
	ScheduledDays int    `json:"scheduledDays"`
	LeaveDays     int    `json:"leaveDays"`
	PresentDays   int    `json:"presentDays"`
	OntimeDays    int    `json:"ontimeDays"`
}

// ComputeOntime is computeOntime (att_ontime for one employee): on-time
// scheduled days over scheduled days minus approved leave; without a
// schedule, on-time days over days present.
func ComputeOntime(schedule []ShiftRow, present []PresentDay, leave map[string]bool, start, end string) CollectorValue {
	byDate := map[string]PresentDay{}
	for _, p := range present {
		byDate[p.Date] = p
	}
	notLate := func(p PresentDay) bool { return p.IsLate == nil || !*p.IsLate }
	d := OntimeDetail{Basis: "attendance", PresentDays: len(present)}
	ontimeScheduled, ontimePresent := 0, 0
	if len(schedule) > 0 {
		d.Basis = "shift_schedule"
		for _, date := range EachDate(start, end) {
			if r := ResolveScheduleRow(schedule, date); r == nil || r.ShiftID == nil {
				continue
			}
			if leave[date] {
				d.LeaveDays++
				continue
			}
			d.ScheduledDays++
			if p, ok := byDate[date]; ok && notLate(p) {
				ontimeScheduled++
			}
		}
	}
	for _, p := range present {
		if notLate(p) {
			ontimePresent++
		}
	}
	num, den := ontimePresent, d.PresentDays
	if len(schedule) > 0 {
		num, den = ontimeScheduled, d.ScheduledDays
	}
	d.OntimeDays = num
	return CollectorValue{Actual: SafeRatio(float64(num), float64(den)), SampleSize: float64(den), Detail: d}
}

// LeaveDates are the dates of approved leaves inside [start, end].
func LeaveDates(leaves []LeaveRange, start, end string) map[string]bool {
	out := map[string]bool{}
	for _, l := range leaves {
		for _, d := range EachDate(max(l.Start, start), min(l.End, end)) {
			out[d] = true
		}
	}
	return out
}

// TeamOntime is collectTeamOntime: each department's average on-time ratio
// over the members that have one, shared with every member.
func TeamOntime(employees []KPIEmployee, ontime map[string]CollectorValue) map[string]CollectorValue {
	type sum struct {
		total float64
		n     int
	}
	sums := map[string]*sum{}
	for _, e := range employees {
		v, ok := ontime[e.ID]
		if e.DepartmentID == nil || !ok || v.Actual == nil {
			continue
		}
		s := sums[*e.DepartmentID]
		if s == nil {
			s = &sum{}
			sums[*e.DepartmentID] = s
		}
		s.total += *v.Actual
		s.n++
	}
	out := map[string]CollectorValue{}
	for _, e := range employees {
		if e.DepartmentID == nil || sums[*e.DepartmentID] == nil {
			continue
		}
		s := sums[*e.DepartmentID]
		avg := s.total / float64(s.n)
		out[e.ID] = CollectorValue{Actual: &avg, SampleSize: float64(s.n),
			Detail: map[string]any{"department_id": *e.DepartmentID, "members_with_data": s.n}}
	}
	return out
}

// ShiftDuration is the hris.shifts columns of the late ratio.
type ShiftDuration struct {
	StartTime, EndTime string
	BreakMinutes       *int
	IsOvernight        bool
}

func clockMinutes(t string) int {
	parts := strings.Split(t, ":")
	h, _ := strconv.Atoi(parts[0])
	m := 0
	if len(parts) > 1 {
		m, _ = strconv.Atoi(parts[1])
	}
	return h*60 + m
}

// ScheduledMinutes is scheduledMinutesForShift: end − start (overnight
// aware) − break, never negative.
func ScheduledMinutes(s ShiftDuration) int {
	end := clockMinutes(s.EndTime)
	if s.IsOvernight {
		end += 24 * 60
	}
	brk := 0
	if s.BreakMinutes != nil {
		brk = *s.BreakMinutes
	}
	return max(0, end-clockMinutes(s.StartTime)-brk)
}

// LateRatio is collectAttLateRatio for one scheduled employee: late
// minutes over the scheduled working minutes of the period.
func LateRatio(schedule []ShiftRow, shifts map[string]ShiftDuration, lateMinutes float64, start, end string) CollectorValue {
	minutes, days := 0, 0
	for _, date := range EachDate(start, end) {
		r := ResolveScheduleRow(schedule, date)
		if r == nil || r.ShiftID == nil {
			continue
		}
		s, ok := shifts[*r.ShiftID]
		if !ok {
			continue
		}
		minutes += ScheduledMinutes(s)
		days++
	}
	return CollectorValue{Actual: SafeRatio(lateMinutes, float64(minutes)), SampleSize: float64(days),
		Detail: map[string]any{"late_minutes": lateMinutes, "scheduled_minutes": minutes, "scheduled_days": days}}
}

// TaskCount is one group of department task occurrences.
type TaskCount struct {
	DepartmentID       string
	AssigneeEmployeeID *string
	DoneBy             *string
	Status             string
	Count              int
}

// TaskCompletion is collectTaskCompletion: approved over due occurrences
// per employee. An occurrence counts for its assignee, else whoever did it;
// one nobody did is due for every member of the department.
func TaskCompletion(employees []KPIEmployee, counts []TaskCount) map[string]CollectorValue {
	out := map[string]CollectorValue{}
	if len(counts) == 0 {
		return out
	}
	type agg struct{ approved, due int }
	per := map[string]*agg{}
	bump := func(id string, approved, due int) {
		a := per[id]
		if a == nil {
			a = &agg{}
			per[id] = a
		}
		a.approved += approved
		a.due += due
	}
	members := map[string][]string{}
	for _, e := range employees {
		if e.DepartmentID != nil {
			members[*e.DepartmentID] = append(members[*e.DepartmentID], e.ID)
		}
	}
	for _, c := range counts {
		approved := 0
		if c.Status == "approved" {
			approved = c.Count
		}
		owner := c.AssigneeEmployeeID
		if owner == nil {
			owner = c.DoneBy
		}
		if owner != nil {
			bump(*owner, approved, c.Count)
			continue
		}
		for _, id := range members[c.DepartmentID] {
			bump(id, 0, c.Count)
		}
	}
	for _, e := range employees {
		a := per[e.ID]
		if a == nil || a.due == 0 {
			continue
		}
		v := float64(a.approved) / float64(a.due)
		out[e.ID] = CollectorValue{Actual: &v, SampleSize: float64(a.due),
			Detail: map[string]any{"approved": a.approved, "due": a.due}}
	}
	return out
}

// RunTimes are a payroll run's approval and payment times.
type RunTimes struct {
	ApprovedAt, PaidAt *time.Time
}

// PayrollTimeliness is collectPayrollTimeliness: the period's runs paid by
// the end of payday (WIB) and approved two days before it. Both are nil
// without a run.
func PayrollTimeliness(payrollDay, year, month int, runs []RunTimes) (paid, ready *CollectorValue) {
	if len(runs) == 0 {
		return nil, nil
	}
	last := time.Date(year, time.Month(month)+1, 0, 0, 0, 0, 0, time.UTC).Day()
	// End of payday in WIB is 16:59:59 UTC that day.
	payday := time.Date(year, time.Month(month), min(payrollDay, last), 23-7, 59, 59, 0, time.UTC)
	deadline := payday.AddDate(0, 0, -2)
	paidN, readyN := 0, 0
	for _, r := range runs {
		if r.PaidAt != nil && !r.PaidAt.After(payday) {
			paidN++
		}
		if r.ApprovedAt != nil && !r.ApprovedAt.After(deadline) {
			readyN++
		}
	}
	total := float64(len(runs))
	return &CollectorValue{SafeRatio(float64(paidN), total), total,
			map[string]any{"payroll_day": payrollDay, "runs": len(runs), "paid_ontime": paidN}},
		&CollectorValue{SafeRatio(float64(readyN), total), total,
			map[string]any{"payroll_day": payrollDay, "runs": len(runs), "ready_h2": readyN}}
}

// KPITarget is a performance.kpi_targets row; nil scopes match anything.
type KPITarget struct {
	PeriodYear, PeriodMonth            *int
	RoleCode, DepartmentID, EmployeeID *string
	Target                             float64
}

// TargetContext is who and when a target is resolved for.
type TargetContext struct {
	EmployeeID   string
	DepartmentID *string
	RoleCode     string
	Month, Year  int
}

func (t KPITarget) scopeRank() int {
	switch {
	case t.EmployeeID != nil:
		return 8
	case t.DepartmentID != nil:
		return 4
	case t.RoleCode != nil:
		return 2
	}
	return 1
}

func (t KPITarget) periodRank() int {
	r := 0
	if t.PeriodMonth != nil {
		r += 2
	}
	if t.PeriodYear != nil {
		r++
	}
	return r
}

func (t KPITarget) matches(c TargetContext) bool {
	switch {
	case t.EmployeeID != nil && *t.EmployeeID != c.EmployeeID,
		t.DepartmentID != nil && (c.DepartmentID == nil || *t.DepartmentID != *c.DepartmentID),
		t.RoleCode != nil && *t.RoleCode != c.RoleCode,
		t.PeriodYear != nil && *t.PeriodYear != c.Year,
		t.PeriodMonth != nil && *t.PeriodMonth != c.Month:
		return false
	}
	return true
}

// ResolveTarget is resolveTarget: the most specific matching row (scope
// employee > department > role > generic, then exact month > year only >
// any period), else the indicator's default.
func ResolveTarget(rows []KPITarget, c TargetContext, def *float64) *float64 {
	var candidates []KPITarget
	for _, r := range rows {
		if r.matches(c) {
			candidates = append(candidates, r)
		}
	}
	if len(candidates) == 0 {
		return def
	}
	sort.SliceStable(candidates, func(i, j int) bool {
		a, b := candidates[i], candidates[j]
		if a.scopeRank() != b.scopeRank() {
			return a.scopeRank() > b.scopeRank()
		}
		return a.periodRank() > b.periodRank()
	})
	return &candidates[0].Target
}
