package domain

import (
	"testing"
	"time"
)

func TestClassReminderDue(t *testing.T) {
	start := time.Date(2026, 10, 21, 10, 0, 0, 0, time.UTC)
	cases := []struct {
		name    string
		now     time.Time
		minutes int
		want    bool
	}{
		{"before the window", start.Add(-121 * time.Minute), 120, false},
		{"window opens", start.Add(-120 * time.Minute), 120, true},
		{"inside the window", start.Add(-5 * time.Minute), 120, true},
		{"class started", start, 120, false},
		{"class over", start.Add(time.Hour), 120, false},
		{"reminders off", start.Add(-5 * time.Minute), 0, false},
	}
	for _, c := range cases {
		if got := ClassReminderDue(start, c.now, c.minutes); got != c.want {
			t.Errorf("%s: ClassReminderDue = %v, want %v", c.name, got, c.want)
		}
	}
}

func TestClassReminderPeriodFollowsStartTime(t *testing.T) {
	wib := time.FixedZone("WIB", 7*3600)
	start := time.Date(2026, 10, 21, 17, 0, 0, 0, wib)
	if got := ClassReminderPeriod(start); got != "2026-10-21T10:00:00Z" {
		t.Fatalf("period = %q", got)
	}
	if ClassReminderPeriod(start) == ClassReminderPeriod(start.Add(time.Hour)) {
		t.Fatal("a moved class must get a new period")
	}
}
