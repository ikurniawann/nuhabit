package domain

import (
	"testing"
	"time"

	"nuhabit/backend/internal/platform/localtime"
)

var (
	wib  = localtime.Jakarta
	wita = localtime.Zone("Asia/Makassar")
	wit  = localtime.Zone("Asia/Jayapura")
)

func at(s string, loc *time.Location) time.Time {
	t, err := time.ParseInLocation("2006-01-02 15:04", s, loc)
	if err != nil {
		panic(err)
	}
	return t
}

func f(v float64) *float64 { return &v }

func TestEffectiveProgress(t *testing.T) {
	cases := []struct {
		status          string
		manual, subtask *float64
		want            int
	}{
		{StatusApproved, nil, nil, 100},
		{StatusDone, f(10), nil, 100},
		{StatusPending, f(50), f(50), 0},
		{StatusInProgress, f(40), nil, 40},
		{StatusInProgress, f(40), f(66.7), 67},
		{StatusRejected, nil, f(100), 99},
		{StatusInProgress, nil, nil, 0},
	}
	for _, c := range cases {
		if got := EffectiveProgress(c.status, c.manual, c.subtask); got != c.want {
			t.Errorf("%s manual %v subtask %v: %d, want %d", c.status, c.manual, c.subtask, got, c.want)
		}
	}
}

func TestOverdue(t *testing.T) {
	today := "2026-10-22"
	if !OccurrenceOverdue("2026-10-21", StatusPending, today) || !OccurrenceOverdue("2026-10-21", StatusInProgress, today) ||
		!OccurrenceOverdue("2026-10-21", StatusRejected, today) {
		t.Error("open rows due yesterday are overdue")
	}
	if OccurrenceOverdue("2026-10-21", StatusDone, today) || OccurrenceOverdue(today, StatusPending, today) {
		t.Error("done rows and today's rows are not overdue")
	}
}

// 23.30 WIB on Saturday the 31st is already Sunday 1 November in Jayapura:
// the view ranges follow the reader's zone.
func TestViewRangeFollowsZone(t *testing.T) {
	now := at("2026-10-28 14:00", wib) // Wednesday
	check := func(view string, loc *time.Location, start, end string) {
		t.Helper()
		if r := ViewRange(view, now, loc); r.Start != start || r.End != end {
			t.Errorf("%s in %s: [%s, %s], want [%s, %s]", view, localtime.Name(loc), r.Start, r.End, start, end)
		}
	}
	check("today", wib, "2026-10-28", "2026-10-28")
	check("week", wib, "2026-10-26", "2026-11-01")
	check("month", wib, "2026-10-01", "2026-10-31")
	check("bogus", wib, "2026-10-28", "2026-10-28")

	now = at("2026-10-31 23:30", wib)
	check("today", wib, "2026-10-31", "2026-10-31")
	check("today", wit, "2026-11-01", "2026-11-01")
	check("month", wit, "2026-11-01", "2026-11-30")
	check("month", wib, "2026-10-01", "2026-10-31")
	// Sunday 23.30 WIB is Monday 00.30 WITA: a new week there.
	now = at("2026-11-01 23:30", wib)
	check("week", wib, "2026-10-26", "2026-11-01")
	check("week", wita, "2026-11-02", "2026-11-08")
	if _, ok := MonthSpan("2026-13"); ok {
		t.Error("month 13")
	}
	if r, ok := MonthSpan("2028-02"); !ok || r.End != "2028-02-29" {
		t.Errorf("leap month %v %v", r, ok)
	}
}

func TestReminderDue(t *testing.T) {
	now := at("2026-10-27 05:30", wib) // 06.30 WITA, 07.30 WIT
	if ReminderDue(now, DigestHour, wib) || ReminderDue(now, DigestHour, wita) || !ReminderDue(now, DigestHour, wit) {
		t.Error("only Jayapura has reached 07.00")
	}
	if !ReminderDue(at("2026-10-27 07:00", wib), DigestHour, nil) {
		t.Error("nil zone is Jakarta")
	}
	if ReminderDue(at("2026-10-27 15:59", wib), OverdueHour, wib) || !ReminderDue(at("2026-10-27 16:00", wib), OverdueHour, wib) {
		t.Error("overdue hour")
	}
}

func TestMonitorSummaries(t *testing.T) {
	today := "2026-10-22"
	pras, rara := "a1", "a2"
	row := func(dept, name, date, status string, progress int, assignee *string, assigneeName string) MonitorRow {
		r := MonitorRow{TaskID: "t1", Title: "Cek alat", DepartmentID: dept, DepartmentName: name, Date: date, Status: status, Progress: progress, AssigneeID: assignee}
		if assignee != nil {
			r.AssigneeName = &assigneeName
		}
		return r
	}
	rows := []MonitorRow{
		row("d1", "Coach", "2026-10-20", StatusApproved, 100, &pras, "Pras"),
		row("d1", "Coach", "2026-10-21", StatusInProgress, 50, &pras, "Pras"),
		row("d1", "Coach", today, StatusDone, 100, &pras, "Pras"),
		row("d1", "Coach", "2026-10-25", StatusPending, 0, &pras, "Pras"), // upcoming: not due
		row("d2", "Front desk", "2026-10-18", StatusPending, 0, nil, ""),
		row("d2", "Front desk", "2026-10-19", StatusApproved, 100, &rara, "Rara"),
	}
	s := Summarize(rows[:4], today)
	if s.Scheduled != 4 || s.Due != 3 || s.Approved != 1 || s.WaitingReview != 1 || s.InProgress != 1 || s.Overdue != 1 ||
		s.Completion == nil || *s.Completion < 0.33 || *s.Completion > 0.34 || s.AvgProgress == nil || *s.AvgProgress != 83 {
		t.Fatalf("summary %+v", s)
	}
	if e := Summarize(nil, today); e.Due != 0 || e.Completion != nil || e.AvgProgress != nil {
		t.Fatalf("empty %+v", e)
	}
	g := GroupByDepartment(rows, today)
	if len(g) != 2 || g[0].DepartmentName != "Coach" || g[0].Overdue != 1 || g[0].Due != 3 || g[1].DepartmentName != "Front desk" || g[1].Due != 2 {
		t.Fatalf("departments %+v", g)
	}
	if a := g[1].Assignees; len(a) != 2 || a[0].AssigneeName != "Departemen (tanpa PJ)" || a[0].Overdue != 1 || a[1].AssigneeName != "Rara" || a[1].Overdue != 0 {
		t.Fatalf("assignees %+v", a)
	}
	if o := OverdueList(rows, today, 50); len(o) != 2 || o[0].Date != "2026-10-18" || o[1].Date != "2026-10-21" {
		t.Fatalf("overdue %+v", o)
	}
	if w := WaitingReview(rows, 50); len(w) != 1 || w[0].Date != today {
		t.Fatalf("waiting %+v", w)
	}
}
