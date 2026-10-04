package domain

import (
	"encoding/json"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// Task vocabularies of lib/sales-funnel/tasks.ts.
var (
	TaskSubjectTypes        = []string{"lead", "deal", "account", "contact", "member"}
	TaskPriorities          = []string{"low", "normal", "high", "urgent"}
	TaskStatuses            = []string{"open", "in_progress", "done", "cancelled"}
	ReminderChannels        = []string{"wa", "in_app", "email"}
	DefaultReminderChannels = []string{"wa", "in_app"}
	RecurrenceFreqs         = []string{"daily", "weekly", "monthly"}
)

// Recurrence is recurrenceSchema's output.
type Recurrence struct {
	Freq     string  `json:"freq"`
	Interval int     `json:"interval"`
	Until    *string `json:"until"`
}

var isoDateRe = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)

// IsISODate is /^\d{4}-\d{2}-\d{2}$/.
func IsISODate(s string) bool { return isoDateRe.MatchString(s) }

// IsParsableISODate is the regex plus !isNaN(Date.parse(s)): V8 takes any
// month 01..12 and day 01..31, whatever the month's length.
func IsParsableISODate(s string) bool {
	if !IsISODate(s) {
		return false
	}
	m, d := s[5:7], s[8:10]
	return m >= "01" && m <= "12" && d >= "01" && d <= "31"
}

// ParseRecurrence is recurrenceSchema.safeParse on a stored jsonb value:
// strict object, freq enum, integer interval 1..52 (default 1), until
// YYYY-MM-DD or null (default null).
func ParseRecurrence(v any) (Recurrence, bool) {
	obj, ok := v.(map[string]any)
	if !ok {
		return Recurrence{}, false
	}
	for k := range obj {
		if k != "freq" && k != "interval" && k != "until" {
			return Recurrence{}, false
		}
	}
	freq, ok := obj["freq"].(string)
	if !ok || !Contains(RecurrenceFreqs, freq) {
		return Recurrence{}, false
	}
	r := Recurrence{Freq: freq, Interval: 1}
	if raw, present := obj["interval"]; present {
		n, ok := jsonNumber(raw)
		if !ok || n != float64(int(n)) || n < 1 || n > 52 {
			return Recurrence{}, false
		}
		r.Interval = int(n)
	}
	if raw, present := obj["until"]; present && raw != nil {
		s, ok := raw.(string)
		if !ok || !IsISODate(s) {
			return Recurrence{}, false
		}
		r.Until = &s
	}
	return r, true
}

func jsonNumber(v any) (float64, bool) {
	switch x := v.(type) {
	case float64:
		return x, true
	case json.Number:
		f, err := x.Float64()
		return f, err == nil
	}
	return 0, false
}

// Subject is a task's polymorphic subject.
type Subject struct {
	Type string `json:"subject_type"`
	ID   string `json:"subject_id"`
}

// ResolveTaskSubject is resolveTaskSubject: deal_id, then lead_id, then the
// explicit subject.
func ResolveTaskSubject(subjectType, subjectID, dealID, leadID string) *Subject {
	switch {
	case dealID != "":
		return &Subject{"deal", dealID}
	case leadID != "":
		return &Subject{"lead", leadID}
	case subjectType != "" && subjectID != "":
		return &Subject{subjectType, subjectID}
	}
	return nil
}

// ResolveTaskStatus is resolveTaskStatus ("" = undefined).
func ResolveTaskStatus(status string, isDone *bool) string {
	switch {
	case status != "":
		return status
	case isDone != nil && *isDone:
		return "done"
	case isDone != nil:
		return "open"
	}
	return ""
}

// IsTaskOpen is isTaskOpen.
func IsTaskOpen(status string) bool { return status == "open" || status == "in_progress" }

func addMonthsClamped(t time.Time, months int) time.Time {
	day := t.Day()
	first := time.Date(t.Year(), t.Month(), 1, t.Hour(), t.Minute(), t.Second(), t.Nanosecond(), time.UTC).AddDate(0, months, 0)
	last := time.Date(first.Year(), first.Month()+1, 0, 0, 0, 0, 0, time.UTC).Day()
	return first.AddDate(0, 0, min(day, last)-1)
}

// NextOccurrence is nextOccurrence: nil once past until (inclusive, end
// of that UTC day); monthly clamps to the end of the month.
func NextOccurrence(from time.Time, r Recurrence) *time.Time {
	from = from.UTC()
	interval := r.Interval
	var next time.Time
	switch r.Freq {
	case "daily":
		next = from.Add(time.Duration(interval) * 24 * time.Hour)
	case "weekly":
		next = from.Add(time.Duration(interval) * 7 * 24 * time.Hour)
	default:
		next = addMonthsClamped(from, interval)
	}
	if r.Until != nil {
		parts := strings.Split(*r.Until, "-")
		y, _ := strconv.Atoi(parts[0])
		m, _ := strconv.Atoi(parts[1])
		d, _ := strconv.Atoi(parts[2])
		untilEnd := time.Date(y, time.Month(m), d, 23, 59, 59, 999_000_000, time.UTC)
		if next.After(untilEnd) {
			return nil
		}
	}
	return &next
}

// SpawnNextTask is spawnNextTask: the next due date, with the reminder
// shifted by the same offset (nil reminder when the task had none). ok is
// false when the series is over.
func SpawnNextTask(due time.Time, reminder *time.Time, r Recurrence) (nextDue time.Time, nextReminder *time.Time, ok bool) {
	next := NextOccurrence(due, r)
	if next == nil {
		return time.Time{}, nil, false
	}
	if reminder != nil {
		rem := next.Add(-due.Sub(*reminder))
		nextReminder = &rem
	}
	return *next, nextReminder, true
}
