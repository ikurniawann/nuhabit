package domain

import (
	"slices"
	"sort"
	"time"

	"nuhabit/backend/internal/platform/localtime"
)

// Department task occurrences as the to-do views, the monitor and the
// reminders read them (lib/hris/dept-task-monitor.ts in the client fork):
// status rules, effective progress, the day ranges of Hari ini / Minggu ini
// / Bulan ini and the digest window. Dates are YYYY-MM-DD strings; the zone
// only decides which day "today" is.

// Occurrence statuses: pending → in_progress → done (waiting review) →
// approved | rejected. Rejected goes back to work.
const (
	StatusPending    = "pending"
	StatusInProgress = "in_progress"
	StatusDone       = "done"
	StatusApproved   = "approved"
	StatusRejected   = "rejected"
)

var (
	OccurrenceStatuses = []string{StatusPending, StatusInProgress, StatusDone, StatusApproved, StatusRejected}
	TaskPriorities     = []string{"low", "normal", "high", "urgent"}
	TaskViews          = []string{"today", "week", "month", "all"}
)

func ValidPriority(s string) bool { return slices.Contains(TaskPriorities, s) }

// OccurrenceOpen reports whether work is still owed: not started, in
// progress or sent back.
func OccurrenceOpen(status string) bool {
	return status == StatusPending || status == StatusInProgress || status == StatusRejected
}

// OccurrenceOverdue is isOverdue: due before today and still open.
func OccurrenceOverdue(date, status, today string) bool {
	return date < today && OccurrenceOpen(status)
}

// EffectiveProgress is effectiveProgress: done or approved 100, pending 0,
// otherwise the weighted sub-task share when the task has sub-tasks, else
// the percent the assignee entered, capped at 99 (rejected included: it
// needs rework).
func EffectiveProgress(status string, manualPercent, subtaskPercent *float64) int {
	switch status {
	case StatusDone, StatusApproved:
		return 100
	case StatusPending:
		return 0
	}
	raw := 0.0
	if subtaskPercent != nil {
		raw = *subtaskPercent
	} else if manualPercent != nil {
		raw = *manualPercent
	}
	return max(0, min(99, int(Round(raw))))
}

// Day is the calendar day of t in loc at midnight; nil loc is Jakarta.
func Day(t time.Time, loc *time.Location) time.Time { return localtime.DayStart(t, loc) }

// DayKey is t's day in loc as YYYY-MM-DD.
func DayKey(t time.Time, loc *time.Location) string { return localtime.DayKey(t, loc) }

// DaySpan is an inclusive span of days as YYYY-MM-DD.
type DaySpan struct{ Start, End string }

// ViewRange is the day span of a list view at now in loc: today, this ISO
// week (Monday to Sunday) or this calendar month. An unknown view is today.
func ViewRange(view string, now time.Time, loc *time.Location) DaySpan {
	today := Day(now, loc)
	switch view {
	case "week":
		start := localtime.WeekStart(today, loc)
		return DaySpan{start.Format(isoDate), start.AddDate(0, 0, 6).Format(isoDate)}
	case "month":
		start := time.Date(today.Year(), today.Month(), 1, 0, 0, 0, 0, today.Location())
		return DaySpan{start.Format(isoDate), start.AddDate(0, 1, -1).Format(isoDate)}
	default:
		return DaySpan{today.Format(isoDate), today.Format(isoDate)}
	}
}

// MonthSpan is MonthRange as a DaySpan, or false for a bad month.
func MonthSpan(month string) (DaySpan, bool) {
	if _, err := time.Parse("2006-01", month); err != nil {
		return DaySpan{}, false
	}
	s, e := MonthRange(month)
	return DaySpan{s, e}, true
}

// DigestHour and OverdueHour are the local clock hours of the morning
// digest and the afternoon overdue reminder.
const (
	DigestHour  = 7
	OverdueHour = 16
)

// ReminderDue reports whether now has reached hour o'clock of its day in
// loc. Together with a per-day sent log it makes a job that runs every few
// minutes send once a day, the first run after the hour.
func ReminderDue(now time.Time, hour int, loc *time.Location) bool {
	return now.In(localtime.Zone(localtime.Name(loc))).Hour() >= hour
}

/* ── Monitor (EPIC-068) ─────────────────────────────────────────────────── */

// MonitorRow is one occurrence as the monitor counts it.
type MonitorRow struct {
	OccurrenceID   string  `json:"occurrence_id"`
	TaskID         string  `json:"task_id"`
	Title          string  `json:"title"`
	DepartmentID   string  `json:"department_id"`
	DepartmentName string  `json:"department_name"`
	AssigneeID     *string `json:"assignee_id"`
	AssigneeName   *string `json:"assignee_name"`
	Date           string  `json:"occurrence_date"`
	Status         string  `json:"status"`
	Progress       int     `json:"progress"`
	LastNote       *string `json:"last_note"`
	LastNoteAt     *string `json:"last_note_at"`
}

// MonitorSummary counts the rows due up to today: completion is approved
// over due (the task_completion KPI), avg progress the mean effective
// progress of the due rows.
type MonitorSummary struct {
	Scheduled     int      `json:"scheduled"`
	Due           int      `json:"due"`
	Approved      int      `json:"approved"`
	WaitingReview int      `json:"waiting_review"`
	InProgress    int      `json:"in_progress"`
	NotStarted    int      `json:"not_started"`
	Rejected      int      `json:"rejected"`
	Overdue       int      `json:"overdue"`
	Completion    *float64 `json:"completion"`
	AvgProgress   *int     `json:"avg_progress"`
}

// Summarize is summarize.
func Summarize(rows []MonitorRow, today string) MonitorSummary {
	s := MonitorSummary{Scheduled: len(rows)}
	sum := 0
	for _, r := range rows {
		if OccurrenceOverdue(r.Date, r.Status, today) {
			s.Overdue++
		}
		if r.Date > today {
			continue
		}
		s.Due++
		sum += r.Progress
		switch r.Status {
		case StatusApproved:
			s.Approved++
		case StatusDone:
			s.WaitingReview++
		case StatusInProgress:
			s.InProgress++
		case StatusPending:
			s.NotStarted++
		case StatusRejected:
			s.Rejected++
		}
	}
	if s.Due > 0 {
		c := float64(s.Approved) / float64(s.Due)
		avg := int(Round(float64(sum) / float64(s.Due)))
		s.Completion, s.AvgProgress = &c, &avg
	}
	return s
}

// AssigneeSummary is a MonitorSummary per person responsible.
type AssigneeSummary struct {
	AssigneeID   *string `json:"assignee_id"`
	AssigneeName string  `json:"assignee_name"`
	MonitorSummary
}

// DepartmentSummary is a MonitorSummary per department with its assignees.
type DepartmentSummary struct {
	DepartmentID   string `json:"department_id"`
	DepartmentName string `json:"department_name"`
	MonitorSummary
	Assignees []AssigneeSummary `json:"assignees"`
}

// GroupByDepartment is groupByDepartment: a summary per department and
// per assignee, the most overdue first.
func GroupByDepartment(rows []MonitorRow, today string) []DepartmentSummary {
	byDept := map[string][]MonitorRow{}
	var order []string
	for _, r := range rows {
		if _, ok := byDept[r.DepartmentID]; !ok {
			order = append(order, r.DepartmentID)
		}
		byDept[r.DepartmentID] = append(byDept[r.DepartmentID], r)
	}
	out := []DepartmentSummary{}
	for _, id := range order {
		deptRows := byDept[id]
		byAssignee := map[string][]MonitorRow{}
		var keys []string
		for _, r := range deptRows {
			key := ""
			if r.AssigneeID != nil {
				key = *r.AssigneeID
			}
			if _, ok := byAssignee[key]; !ok {
				keys = append(keys, key)
			}
			byAssignee[key] = append(byAssignee[key], r)
		}
		assignees := []AssigneeSummary{}
		for _, key := range keys {
			items := byAssignee[key]
			a := AssigneeSummary{AssigneeName: "Departemen (tanpa PJ)", MonitorSummary: Summarize(items, today)}
			if key != "" {
				a.AssigneeID = &key
				a.AssigneeName = "—"
				if items[0].AssigneeName != nil {
					a.AssigneeName = *items[0].AssigneeName
				}
			}
			assignees = append(assignees, a)
		}
		sort.SliceStable(assignees, func(i, j int) bool {
			if assignees[i].Overdue != assignees[j].Overdue {
				return assignees[i].Overdue > assignees[j].Overdue
			}
			return assignees[i].AssigneeName < assignees[j].AssigneeName
		})
		out = append(out, DepartmentSummary{DepartmentID: id, DepartmentName: deptRows[0].DepartmentName,
			MonitorSummary: Summarize(deptRows, today), Assignees: assignees})
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Overdue != out[j].Overdue {
			return out[i].Overdue > out[j].Overdue
		}
		return out[i].DepartmentName < out[j].DepartmentName
	})
	return out
}

// OverdueList is overdueList: the overdue rows, oldest first, at most limit.
func OverdueList(rows []MonitorRow, today string, limit int) []MonitorRow {
	out := []MonitorRow{}
	for _, r := range rows {
		if OccurrenceOverdue(r.Date, r.Status, today) {
			out = append(out, r)
		}
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Date != out[j].Date {
			return out[i].Date < out[j].Date
		}
		return out[i].Title < out[j].Title
	})
	if len(out) > limit {
		out = out[:limit]
	}
	return out
}

// WaitingReview lists the rows waiting for a reviewer, oldest first.
func WaitingReview(rows []MonitorRow, limit int) []MonitorRow {
	out := []MonitorRow{}
	for _, r := range rows {
		if r.Status == StatusDone {
			out = append(out, r)
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Date < out[j].Date })
	if len(out) > limit {
		out = out[:limit]
	}
	return out
}
