package domain

import (
	"strconv"
	"strings"
	"time"
)

// ── Overlap ─────────────────────────────────────────────────────────────────

// Slot is a session's place in the timetable: who teaches, where, and when.
type Slot struct {
	ID        string
	ClassName string
	CoachID   *string
	CoachName *string
	BranchID  *string
	Area      *string
	StartsAt  time.Time
	EndsAt    time.Time
}

type ConflictKind string

const (
	ConflictCoach ConflictKind = "coach"
	ConflictRoom  ConflictKind = "room"
)

// ScheduleConflict names the session that already holds the coach or the room.
type ScheduleConflict struct {
	Kind ConflictKind
	With Slot
}

// Message is the Indonesian error shown to staff.
func (c ScheduleConflict) Message() string {
	when := FormatWib(c.With.StartsAt) + "–" + c.With.EndsAt.In(WIB).Format("15.04")
	if c.Kind == ConflictCoach {
		name := "Coach ini"
		if c.With.CoachName != nil {
			name = "Coach " + *c.With.CoachName
		}
		return name + " sudah mengajar " + c.With.ClassName + " pada " + when
	}
	return "Area " + strings.TrimSpace(*c.With.Area) + " sudah dipakai " + c.With.ClassName + " pada " + when
}

// roomKey is the room a session uses: the area within its branch. A session
// without an area holds no room.
func roomKey(s Slot) (string, bool) {
	if s.Area == nil || strings.TrimSpace(*s.Area) == "" {
		return "", false
	}
	branch := ""
	if s.BranchID != nil {
		branch = *s.BranchID
	}
	return branch + "|" + strings.ToLower(strings.TrimSpace(*s.Area)), true
}

// overlaps treats sessions as [start, end): back-to-back classes do not clash.
func overlaps(a, b Slot) bool {
	return a.StartsAt.Before(b.EndsAt) && b.StartsAt.Before(a.EndsAt)
}

// FindScheduleConflict returns the first other session that overlaps s in
// time and shares its coach or its room, coach clashes first. Others with
// s's own ID are ignored, so an edited session never clashes with itself.
func FindScheduleConflict(s Slot, others []Slot) *ScheduleConflict {
	room, hasRoom := roomKey(s)
	var roomClash *ScheduleConflict
	for _, o := range others {
		if (s.ID != "" && o.ID == s.ID) || !overlaps(s, o) {
			continue
		}
		if s.CoachID != nil && o.CoachID != nil && *s.CoachID == *o.CoachID {
			return &ScheduleConflict{Kind: ConflictCoach, With: o}
		}
		if other, ok := roomKey(o); roomClash == nil && hasRoom && ok && other == room {
			roomClash = &ScheduleConflict{Kind: ConflictRoom, With: o}
		}
	}
	return roomClash
}

// ── Weekly templates ────────────────────────────────────────────────────────

// WeeklySlot is a recurring template: an ISO weekday (1 = Monday … 7 =
// Sunday) and a start time in WIB, valid between two dates (YYYY-MM-DD,
// ValidUntil "" = open ended).
type WeeklySlot struct {
	Weekday     int
	StartTime   string // "HH:MM" or "HH:MM:SS"
	DurationMin int
	ValidFrom   string
	ValidUntil  string
}

// Occurrence is one dated session a template produces.
type Occurrence struct {
	Date     string // YYYY-MM-DD in WIB
	StartsAt time.Time
	EndsAt   time.Time
}

// ParseClock reads "HH:MM" or "HH:MM:SS" as minutes after midnight.
func ParseClock(s string) (int, bool) {
	parts := strings.Split(s, ":")
	if len(parts) < 2 || len(parts) > 3 || len(parts[0]) != 2 || len(parts[1]) != 2 {
		return 0, false
	}
	h, err1 := strconv.Atoi(parts[0])
	m, err2 := strconv.Atoi(parts[1])
	if err1 != nil || err2 != nil || h < 0 || h > 23 || m < 0 || m > 59 {
		return 0, false
	}
	return h*60 + m, true
}

// isoWeekday is 1 for Monday … 7 for Sunday.
func isoWeekday(t time.Time) int {
	if d := int(t.Weekday()); d != 0 {
		return d
	}
	return 7
}

// TemplateOccurrences lists the sessions a weekly slot produces that start
// after now and before now + horizonDays. Dates and times are WIB.
func TemplateOccurrences(t WeeklySlot, now time.Time, horizonDays int) []Occurrence {
	minute, ok := ParseClock(t.StartTime)
	if !ok || horizonDays <= 0 {
		return nil
	}
	until := now.Add(time.Duration(horizonDays) * 24 * time.Hour)
	local := now.In(WIB)
	var out []Occurrence
	for i := 0; i <= horizonDays; i++ {
		day := time.Date(local.Year(), local.Month(), local.Day()+i, 0, 0, 0, 0, WIB)
		date := day.Format(time.DateOnly)
		if isoWeekday(day) != t.Weekday || date < t.ValidFrom || (t.ValidUntil != "" && date > t.ValidUntil) {
			continue
		}
		startsAt := day.Add(time.Duration(minute) * time.Minute)
		if !startsAt.After(now) || !startsAt.Before(until) {
			continue
		}
		out = append(out, Occurrence{
			Date: date, StartsAt: startsAt, EndsAt: startsAt.Add(time.Duration(t.DurationMin) * time.Minute),
		})
	}
	return out
}

// ── Moved sessions ──────────────────────────────────────────────────────────

// MoveNoticeWindow: after the studio moves a session, members booked before
// the move may cancel free of charge for this long.
const MoveNoticeWindow = 24 * time.Hour

// SessionMove records the studio's last move of a session; both nil when the
// session was never moved.
type SessionMove struct {
	MovedAt          *time.Time
	OriginalStartsAt *time.Time
}

// WaiveLateCancelForMove lifts the late-cancel penalty for a member who
// booked before the studio moved the session. Their free deadline becomes
// the latest of: the deadline from the new start, the deadline from the
// original start, and MoveNoticeWindow after the move, but never later than
// the new start. Bookings made after the move keep the outcome unchanged.
func WaiveLateCancelForMove(out CancellationOutcome, move SessionMove, bookedAt time.Time, rules Rules, now time.Time) CancellationOutcome {
	if move.MovedAt == nil || move.OriginalStartsAt == nil || !bookedAt.Before(*move.MovedAt) {
		return out
	}
	deadline := out.Deadline
	if original := CancellationDeadline(*move.OriginalStartsAt, rules); original.After(deadline) {
		deadline = original
	}
	if notice := move.MovedAt.Add(MoveNoticeWindow); notice.After(deadline) {
		deadline = notice
	}
	if startsAt := out.Deadline.Add(time.Duration(rules.CancellationDeadlineHours) * time.Hour); deadline.After(startsAt) {
		deadline = startsAt
	}
	if now.After(deadline) {
		return out
	}
	return CancellationOutcome{Deadline: deadline}
}
