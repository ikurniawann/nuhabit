package domain

import (
	"testing"
	"time"

	"nuhabit/backend/internal/platform/localtime"
)

func TestChangeNoticeLate(t *testing.T) {
	start := at("2026-10-05T11:00:00Z") // 18.00 WIB
	if ChangeNoticeLate(start, start.Add(-13*time.Hour), 12) {
		t.Fatal("13 hours ahead is on time")
	}
	if !ChangeNoticeLate(start, start.Add(-11*time.Hour), 12) {
		t.Fatal("11 hours ahead is late")
	}
	if ChangeNoticeLate(start, start.Add(-time.Minute), 0) {
		t.Fatal("0 hours never flags")
	}
}

func TestChangeNoticeAtQuietHours(t *testing.T) {
	wita := localtime.Zone("Asia/Makassar")
	wit := localtime.Zone("Asia/Jayapura")
	cases := []struct {
		name       string
		now, start string
		zone       *time.Location
		want       string // "" = at once
	}{
		{"afternoon in Jakarta sends now", "2026-10-05T08:00:00Z", "2026-10-06T11:00:00Z", localtime.Jakarta, ""},
		{"20.59 WIB sends now", "2026-10-05T13:59:00Z", "2026-10-06T11:00:00Z", localtime.Jakarta, ""},
		{"21.00 WIB waits for 07.00 WIB", "2026-10-05T14:00:00Z", "2026-10-06T11:00:00Z", localtime.Jakarta, "2026-10-06T00:00:00Z"},
		{"02.00 WIB waits for 07.00 the same day", "2026-10-05T19:00:00Z", "2026-10-06T11:00:00Z", localtime.Jakarta, "2026-10-06T00:00:00Z"},
		{"07.00 WIB sends now", "2026-10-06T00:00:00Z", "2026-10-06T11:00:00Z", localtime.Jakarta, ""},
		// 22.00 WIB is 23.00 WITA: quiet in Makassar, held until 07.00 WITA.
		{"Makassar uses its own clock", "2026-10-05T15:00:00Z", "2026-10-06T11:00:00Z", wita, "2026-10-05T23:00:00Z"},
		// 20.30 WIB is 22.30 WIT: quiet in Jayapura while Jakarta is not.
		{"Jayapura is quiet before Jakarta", "2026-10-05T13:30:00Z", "2026-10-06T11:00:00Z", wit, "2026-10-05T22:00:00Z"},
		// A 08.30 WIB class changed at 23.00 WIB: 07.00 is too late, send now.
		{"early class is announced at once", "2026-10-05T16:00:00Z", "2026-10-06T01:30:00Z", localtime.Jakarta, ""},
		// A 10.30 WIB class: 07.00 leaves 3.5 hours, so it waits.
		{"class after the buffer waits", "2026-10-05T16:00:00Z", "2026-10-06T03:30:00Z", localtime.Jakarta, "2026-10-06T00:00:00Z"},
		{"nil zone is Jakarta", "2026-10-05T14:00:00Z", "2026-10-06T11:00:00Z", nil, "2026-10-06T00:00:00Z"},
	}
	for _, c := range cases {
		got := ChangeNoticeAt(at(c.now), at(c.start), c.zone)
		if c.want == "" {
			if !got.IsZero() {
				t.Errorf("%s: held until %s, want at once", c.name, got.UTC().Format(time.RFC3339))
			}
			continue
		}
		if !got.Equal(at(c.want)) {
			t.Errorf("%s: got %s, want %s", c.name, got.UTC().Format(time.RFC3339), c.want)
		}
	}
}

func TestWaiveLateCancelForCoachChange(t *testing.T) {
	start := at("2026-10-05T11:00:00Z")     // 18.00 WIB, normal deadline 14.00 WIB
	changedAt := at("2026-10-05T05:00:00Z") // 12.00 WIB
	booked := at("2026-10-04T10:00:00Z")
	cancelAt := at("2026-10-05T09:00:00Z") // 16.00 WIB, late by the normal rule
	out := EvaluateCancellation(BookingConfirmed, start, 1, false, rules, cancelAt)
	if !out.Late {
		t.Fatalf("precondition: %+v", out)
	}
	change := SessionMove{CoachChangedAt: &changedAt}
	got := WaiveLateCancelForMove(out, change, booked, rules, cancelAt)
	if got.Late || got.PenaltyCredits != 0 || !got.Deadline.Equal(start) {
		t.Fatalf("booked before the coach change: %+v", got)
	}
	if got := WaiveLateCancelForMove(out, change, changedAt.Add(time.Minute), rules, cancelAt); got != out {
		t.Fatalf("booked after the change keeps the penalty: %+v", got)
	}
	short := rules
	short.ChangeFreeCancelHours = 2 // free until 14.00 WIB, before the cancel
	if got := WaiveLateCancelForMove(out, change, booked, short, cancelAt); got != out {
		t.Fatalf("outside a 2 hour window: %+v", got)
	}
	none := rules
	none.ChangeFreeCancelHours = 0
	if got := WaiveLateCancelForMove(out, change, booked, none, cancelAt); got != out {
		t.Fatalf("window 0 waives nothing: %+v", got)
	}
}
