package domain

import "time"

// ReminderWindow is how long before the start a reminder goes out.
type ReminderWindow struct {
	Label  string
	Before time.Duration
}

// ReminderWindows are the two reminders of an event: a day ahead and two
// hours ahead.
var ReminderWindows = []ReminderWindow{
	{Label: "24h", Before: 24 * time.Hour},
	{Label: "2h", Before: 2 * time.Hour},
}

// ReminderHorizon is the furthest ahead the sweep looks: the longest window
// plus one hour of slack.
const ReminderHorizon = 25 * time.Hour

// DueWindow picks the reminder window now falls in, nil when none: the 24h
// window covers [start-24h, start-2h) and the 2h window [start-2h, start),
// so a late run sends the reminder of the window it is in, never both.
func DueWindow(startsAt, now time.Time) *ReminderWindow {
	if !now.Before(startsAt) {
		return nil
	}
	// Shortest window first: at start-1h both windows have opened and the
	// 2h one wins.
	for i := len(ReminderWindows) - 1; i >= 0; i-- {
		w := ReminderWindows[i]
		if !now.Before(startsAt.Add(-w.Before)) {
			return &w
		}
	}
	return nil
}

// ReminderPeriod keys the sent log by window and start time, so a moved
// event earns fresh reminders for its new time.
func ReminderPeriod(w ReminderWindow, startsAt time.Time) string {
	return w.Label + ":" + startsAt.UTC().Format(time.RFC3339)
}
