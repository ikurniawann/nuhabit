package domain

import (
	"fmt"
	"math"
	"regexp"
	"slices"
	"strings"
	"time"
)

// Department tasks (lib/hris/dept-tasks.ts): recurring task lists per
// department whose occurrences are generated lazily per month.

// TaskSchedule is the recurrence part of a department task.
type TaskSchedule struct {
	Recurrence string
	WeeklyDay  *int
	MonthlyDay *int
	DueDate    *string
}

// OccurrenceDates is occurrenceDatesFor: the task's dates in [start, end].
func OccurrenceDates(t TaskSchedule, start, end string) []string {
	out := []string{}
	s, err1 := time.Parse(isoDate, start)
	e, err2 := time.Parse(isoDate, end)
	if err1 != nil || err2 != nil || s.After(e) {
		return out
	}
	if t.Recurrence == "once" {
		if t.DueDate != nil && *t.DueDate != "" && *t.DueDate >= start && *t.DueDate <= end {
			out = append(out, *t.DueDate)
		}
		return out
	}
	for d := s; !d.After(e); d = d.AddDate(0, 0, 1) {
		dow := int(d.Weekday())
		if dow == 0 {
			dow = 7
		}
		switch {
		case t.Recurrence == "daily",
			t.Recurrence == "weekly" && t.WeeklyDay != nil && *t.WeeklyDay == dow,
			t.Recurrence == "monthly" && t.MonthlyDay != nil && *t.MonthlyDay == d.Day():
			out = append(out, d.Format(isoDate))
		}
	}
	return out
}

// MonthRange is monthRange("YYYY-MM").
func MonthRange(month string) (start, end string) {
	t, _ := time.Parse("2006-01", month)
	last := time.Date(t.Year(), t.Month()+1, 0, 0, 0, 0, 0, time.UTC)
	return month + "-01", fmt.Sprintf("%s-%02d", month, last.Day())
}

// Subtask is a weighted sub-task title.
type Subtask struct {
	Title  string
	Weight float64
}

// SplitSubtaskWeights shares 100% evenly; the rounding rest goes to the last.
func SplitSubtaskWeights(titles []string) []Subtask {
	out := []Subtask{}
	if len(titles) == 0 {
		return out
	}
	n := float64(len(titles))
	even := math.Floor(100/n*100) / 100
	for i, t := range titles {
		w := even
		if i == len(titles)-1 {
			w = Round((100-even*(n-1))*100) / 100
		}
		out = append(out, Subtask{t, w})
	}
	return out
}

// TaskBody is the create payload as the TS reads it: day fields are a
// number, a string or null; a nil pointer is absent.
type TaskBody struct {
	Title, Description, Recurrence, DueDate *string
	WeeklyDay, MonthlyDay                   any
	Subtasks                                []*string
}

// NormalizedTask is a validated new task.
type NormalizedTask struct {
	Title       string
	Description *string
	Schedule    TaskSchedule
	Subtasks    []Subtask
}

var isoDateRE = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)

const maxSubtasks = 50

func strOr(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

// NormalizeDeptTask is normalizeDeptTask: the task or a message.
func NormalizeDeptTask(b TaskBody) (*NormalizedTask, string) {
	title := strings.TrimSpace(strOr(b.Title))
	if len([]rune(title)) < 3 {
		return nil, "Judul task minimal 3 karakter"
	}
	recurrence := strOr(b.Recurrence)
	if recurrence == "" {
		recurrence = "once"
	}
	if !slices.Contains([]string{"once", "daily", "weekly", "monthly"}, recurrence) {
		return nil, "Jenis pengulangan tidak dikenal"
	}
	if recurrence == "once" && !isoDateRE.MatchString(strOr(b.DueDate)) {
		return nil, "Task sekali jalan membutuhkan tanggal jatuh tempo"
	}
	weekly, monthly := JSNumber(b.WeeklyDay), JSNumber(b.MonthlyDay)
	isInt := func(x float64) bool { return Finite(x) && x == math.Trunc(x) }
	if recurrence == "weekly" && (!isInt(weekly) || weekly < 1 || weekly > 7) {
		return nil, "Task mingguan membutuhkan hari (Senin–Minggu)"
	}
	if recurrence == "monthly" && (!isInt(monthly) || monthly < 1 || monthly > 28) {
		return nil, "Task bulanan membutuhkan tanggal 1–28"
	}
	var titles []string
	for _, s := range b.Subtasks {
		if t := strings.TrimSpace(strOr(s)); t != "" {
			titles = append(titles, t)
		}
	}
	if len(titles) > maxSubtasks {
		return nil, fmt.Sprintf("Maksimal %d sub-task", maxSubtasks)
	}
	n := &NormalizedTask{Title: title, Schedule: TaskSchedule{Recurrence: recurrence}, Subtasks: SplitSubtaskWeights(titles)}
	if d := strings.TrimSpace(strOr(b.Description)); d != "" {
		n.Description = &d
	}
	switch recurrence {
	case "weekly":
		w := int(weekly)
		n.Schedule.WeeklyDay = &w
	case "monthly":
		m := int(monthly)
		n.Schedule.MonthlyDay = &m
	case "once":
		n.Schedule.DueDate = b.DueDate
	}
	return n, ""
}
