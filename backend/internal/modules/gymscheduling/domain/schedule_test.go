package domain

import (
	"testing"
	"time"
)

func sp(s string) *string { return &s }

func slot(id, coach, branch, area string, from, to string) Slot {
	s := Slot{ID: id, ClassName: "Kelas " + id, StartsAt: at(from), EndsAt: at(to)}
	if coach != "" {
		s.CoachID, s.CoachName = sp(coach), sp("Coach "+coach)
	}
	if branch != "" {
		s.BranchID = sp(branch)
	}
	if area != "" {
		s.Area = sp(area)
	}
	return s
}

func TestFindScheduleConflict(t *testing.T) {
	// 18.00–19.00 WIB on Monday 5 Oct.
	base := slot("new", "kevin", "b1", "Main Floor", "2026-10-05T11:00:00Z", "2026-10-05T12:00:00Z")

	cases := []struct {
		name   string
		others []Slot
		want   ConflictKind
	}{
		{"nothing else", nil, ""},
		{"same coach overlapping", []Slot{slot("a", "kevin", "b2", "Studio", "2026-10-05T11:30:00Z", "2026-10-05T12:30:00Z")}, ConflictCoach},
		{"same coach back to back", []Slot{slot("a", "kevin", "b1", "Main Floor", "2026-10-05T12:00:00Z", "2026-10-05T13:00:00Z")}, ""},
		{"same room overlapping, area case and spaces ignored", []Slot{slot("a", "maya", "b1", " main floor ", "2026-10-05T10:30:00Z", "2026-10-05T11:15:00Z")}, ConflictRoom},
		{"same area name in another branch", []Slot{slot("a", "maya", "b2", "Main Floor", "2026-10-05T11:00:00Z", "2026-10-05T12:00:00Z")}, ""},
		{"no coach and no area on the other", []Slot{slot("a", "", "b1", "", "2026-10-05T11:00:00Z", "2026-10-05T12:00:00Z")}, ""},
		{"itself", []Slot{slot("new", "kevin", "b1", "Main Floor", "2026-10-05T11:00:00Z", "2026-10-05T12:00:00Z")}, ""},
		{"coach clash wins over an earlier room clash", []Slot{
			slot("room", "maya", "b1", "Main Floor", "2026-10-05T11:00:00Z", "2026-10-05T12:00:00Z"),
			slot("coach", "kevin", "b2", "Sled Lane", "2026-10-05T11:00:00Z", "2026-10-05T12:00:00Z"),
		}, ConflictCoach},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := FindScheduleConflict(base, c.others)
			if c.want == "" {
				if got != nil {
					t.Fatalf("want no conflict, got %+v", got)
				}
				return
			}
			if got == nil || got.Kind != c.want {
				t.Fatalf("want %s conflict, got %+v", c.want, got)
			}
		})
	}

	noRoom := base
	noRoom.Area = sp("  ")
	if got := FindScheduleConflict(noRoom, []Slot{slot("a", "maya", "b1", "  ", "2026-10-05T11:00:00Z", "2026-10-05T12:00:00Z")}); got != nil {
		t.Fatalf("blank areas never clash: %+v", got)
	}
}

func TestScheduleConflictMessage(t *testing.T) {
	coach := ScheduleConflict{Kind: ConflictCoach, With: slot("a", "kevin", "b1", "Main Floor", "2026-10-05T11:00:00Z", "2026-10-05T12:30:00Z")}
	if got, want := coach.Message(), "Coach Coach kevin sudah mengajar Kelas a pada Sen, 5 Okt, 18.00–19.30"; got != want {
		t.Fatalf("coach message %q, want %q", got, want)
	}
	room := ScheduleConflict{Kind: ConflictRoom, With: slot("b", "", "b1", " Studio B ", "2026-10-05T11:00:00Z", "2026-10-05T11:45:00Z")}
	if got, want := room.Message(), "Area Studio B sudah dipakai Kelas b pada Sen, 5 Okt, 18.00–18.45"; got != want {
		t.Fatalf("room message %q, want %q", got, want)
	}
}

func TestTemplateOccurrences(t *testing.T) {
	monday1830 := WeeklySlot{Weekday: 1, StartTime: "18:30", DurationMin: 60, ValidFrom: "2026-01-01"}

	t.Run("WIB dates and times inside the horizon", func(t *testing.T) {
		// Sunday 4 Oct 17.00 WIB; 14 days ahead covers Monday 5 and 12 Oct.
		got := TemplateOccurrences(monday1830, at("2026-10-04T10:00:00Z"), 14)
		if len(got) != 2 {
			t.Fatalf("occurrences = %+v", got)
		}
		if got[0].Date != "2026-10-05" || !got[0].StartsAt.Equal(at("2026-10-05T11:30:00Z")) || !got[0].EndsAt.Equal(at("2026-10-05T12:30:00Z")) {
			t.Fatalf("first occurrence = %+v", got[0])
		}
		if got[1].Date != "2026-10-12" {
			t.Fatalf("second occurrence = %+v", got[1])
		}
	})

	t.Run("WIB day differs from the UTC day", func(t *testing.T) {
		// 23.30 UTC Sunday is already Monday 06.30 WIB.
		early := WeeklySlot{Weekday: 1, StartTime: "07:00:00", DurationMin: 60, ValidFrom: "2026-01-01"}
		got := TemplateOccurrences(early, at("2026-10-04T23:30:00Z"), 1)
		if len(got) != 1 || got[0].Date != "2026-10-05" || !got[0].StartsAt.Equal(at("2026-10-05T00:00:00Z")) {
			t.Fatalf("occurrences = %+v", got)
		}
	})

	t.Run("a start already past today is skipped", func(t *testing.T) {
		got := TemplateOccurrences(monday1830, at("2026-10-05T11:30:00Z"), 8)
		if len(got) != 1 || got[0].Date != "2026-10-12" {
			t.Fatalf("occurrences = %+v", got)
		}
	})

	t.Run("valid range is inclusive", func(t *testing.T) {
		ranged := monday1830
		ranged.ValidFrom, ranged.ValidUntil = "2026-10-12", "2026-10-19"
		got := TemplateOccurrences(ranged, at("2026-10-04T10:00:00Z"), 30)
		if len(got) != 2 || got[0].Date != "2026-10-12" || got[1].Date != "2026-10-19" {
			t.Fatalf("occurrences = %+v", got)
		}
	})

	t.Run("no horizon or a bad clock produces nothing", func(t *testing.T) {
		if got := TemplateOccurrences(monday1830, now, 0); got != nil {
			t.Fatalf("zero horizon = %+v", got)
		}
		bad := monday1830
		bad.StartTime = "25:00"
		if got := TemplateOccurrences(bad, now, 14); got != nil {
			t.Fatalf("bad clock = %+v", got)
		}
	})
}

func TestParseClock(t *testing.T) {
	for in, want := range map[string]int{"00:00": 0, "06:30": 390, "23:59:00": 1439} {
		if got, ok := ParseClock(in); !ok || got != want {
			t.Fatalf("ParseClock(%q) = %d %v", in, got, ok)
		}
	}
	for _, in := range []string{"", "6:30", "24:00", "12:60", "12:30:00:00", "ab:cd"} {
		if _, ok := ParseClock(in); ok {
			t.Fatalf("ParseClock(%q) accepted", in)
		}
	}
}

func TestWaiveLateCancelForMove(t *testing.T) {
	// Originally Monday 18.00 WIB; the studio moves it to 10.00 WIB the same day.
	original := at("2026-10-05T11:00:00Z")
	moved := at("2026-10-05T03:00:00Z")
	movedAt := at("2026-10-04T12:00:00Z")
	booked := at("2026-10-03T12:00:00Z")
	move := SessionMove{MovedAt: &movedAt, OriginalStartsAt: &original}

	t.Run("late under the new time, free under the original deadline", func(t *testing.T) {
		cancelAt := at("2026-10-05T02:00:00Z") // 09.00 WIB, new deadline was 06.00
		out := EvaluateCancellation(BookingConfirmed, moved, 2, false, rules, cancelAt)
		if !out.Late || out.PenaltyCredits != 2 {
			t.Fatalf("precondition: %+v", out)
		}
		got := WaiveLateCancelForMove(out, move, booked, rules, cancelAt)
		if got.Late || got.PenaltyCredits != 0 || got.PassStrike || !got.Deadline.Equal(moved) {
			t.Fatalf("waived = %+v", got)
		}
	})

	t.Run("within 24 hours of the notice", func(t *testing.T) {
		// Moved later, from 10.00 to 18.00 WIB, notice sent 15.00 WIB the same day.
		lateMoveAt := at("2026-10-05T08:00:00Z")
		earlier := at("2026-10-05T03:00:00Z")
		m := SessionMove{MovedAt: &lateMoveAt, OriginalStartsAt: &earlier}
		cancelAt := at("2026-10-05T10:30:00Z") // 17.30 WIB, 30 minutes before the new start
		out := EvaluateCancellation(BookingConfirmed, original, 1, true, rules, cancelAt)
		got := WaiveLateCancelForMove(out, m, booked, rules, cancelAt)
		if got.Late || got.PassStrike || !got.Deadline.Equal(original) {
			t.Fatalf("waived = %+v", got)
		}
	})

	t.Run("past every deadline keeps the penalty", func(t *testing.T) {
		// Moved later, from 10.00 to 18.00 WIB, two days ahead.
		earlyMoveAt := at("2026-10-03T00:00:00Z")
		earlier := at("2026-10-05T03:00:00Z")
		m := SessionMove{MovedAt: &earlyMoveAt, OriginalStartsAt: &earlier}
		cancelAt := at("2026-10-05T08:00:00Z") // 15.00 WIB, past 14.00 and the notice window
		out := EvaluateCancellation(BookingConfirmed, original, 2, false, rules, cancelAt)
		if got := WaiveLateCancelForMove(out, m, at("2026-10-02T00:00:00Z"), rules, cancelAt); got != out {
			t.Fatalf("got %+v, want %+v", got, out)
		}
	})

	t.Run("booked after the move or never moved", func(t *testing.T) {
		cancelAt := at("2026-10-05T02:00:00Z")
		out := EvaluateCancellation(BookingConfirmed, moved, 2, false, rules, cancelAt)
		if got := WaiveLateCancelForMove(out, move, movedAt.Add(time.Minute), rules, cancelAt); got != out {
			t.Fatalf("booked after the move: %+v", got)
		}
		if got := WaiveLateCancelForMove(out, SessionMove{}, booked, rules, cancelAt); got != out {
			t.Fatalf("never moved: %+v", got)
		}
	})
}
