package domain

import "time"

// ClassReminderHorizon is the furthest ahead a reminder can be due: the
// maximum of the classReminderMinutes rule (7 days).
const ClassReminderHorizon = 7 * 24 * time.Hour

// ClassReminderDue reports whether a class starting at startsAt is inside
// its reminder window at now: not started yet, and at most minutes away.
// minutes <= 0 turns reminders off.
func ClassReminderDue(startsAt, now time.Time, minutes int) bool {
	if minutes <= 0 || !now.Before(startsAt) {
		return false
	}
	return !now.Before(startsAt.Add(-time.Duration(minutes) * time.Minute))
}

// ClassReminderPeriod keys the sent log by the start time, so a class that
// is moved earns a fresh reminder for its new time.
func ClassReminderPeriod(startsAt time.Time) string {
	return startsAt.UTC().Format(time.RFC3339)
}
