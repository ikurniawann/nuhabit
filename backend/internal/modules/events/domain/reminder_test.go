package domain

import (
	"testing"
	"time"
)

func TestDueWindow(t *testing.T) {
	start := at("2026-11-02T10:00:00Z")
	cases := []struct {
		now  string
		want string
	}{
		{"2026-11-01T09:59:00Z", ""},
		{"2026-11-01T10:00:00Z", "24h"},
		{"2026-11-02T07:59:00Z", "24h"},
		{"2026-11-02T08:00:00Z", "2h"},
		{"2026-11-02T09:59:00Z", "2h"},
		{"2026-11-02T10:00:00Z", ""},
	}
	for _, c := range cases {
		got := ""
		if w := DueWindow(start, at(c.now)); w != nil {
			got = w.Label
		}
		if got != c.want {
			t.Errorf("at %s: want %q, got %q", c.now, c.want, got)
		}
	}
}

func TestReminderPeriodFollowsTheStart(t *testing.T) {
	w := ReminderWindows[0]
	a := ReminderPeriod(w, at("2026-11-02T10:00:00Z"))
	b := ReminderPeriod(w, at("2026-11-02T10:00:00Z").Add(time.Hour))
	if a == b || a != "24h:2026-11-02T10:00:00Z" {
		t.Fatalf("a moved event needs a new key: %q vs %q", a, b)
	}
}
