package domain

import (
	"slices"
	"strings"
	"time"
)

// Minutes is a time of day in WIB as minutes after midnight.
type Minutes int

// EndOfDay is "24:00", the end of a window that runs to midnight.
const EndOfDay Minutes = 24 * 60

// ParseClock reads "HH:MM" or "HH:MM:SS" (a Postgres time column), up to "24:00".
func ParseClock(s string) (Minutes, bool) {
	parts := strings.Split(s, ":")
	if len(parts) < 2 || len(parts) > 3 || len(parts[0]) != 2 {
		return 0, false
	}
	if parts[0] == "24" && strings.Trim(parts[1]+strings.Join(parts[2:], ""), "0") == "" {
		return EndOfDay, true
	}
	t, err := time.Parse("15:04", parts[0]+":"+parts[1])
	if err != nil {
		return 0, false
	}
	return Minutes(t.Hour()*60 + t.Minute()), true
}

// Clock renders m as "HH:MM".
func (m Minutes) Clock() string {
	if m == EndOfDay {
		return "24:00"
	}
	return time.Date(2000, 1, 1, int(m)/60, int(m)%60, 0, 0, time.UTC).Format("15:04")
}

// Span is [Start, End) within one day.
type Span struct{ Start, End Minutes }

// WeeklyWindow is a recurring stretch a coach takes PT, on an ISO weekday
// (1 = Monday … 7 = Sunday).
type WeeklyWindow struct {
	Weekday int
	Span
}

// ExceptionKind: Off takes time away (no span = the whole day), Extra adds it.
type ExceptionKind string

const (
	Off   ExceptionKind = "off"
	Extra ExceptionKind = "extra"
)

// Exception changes one date (YYYY-MM-DD, WIB) of a coach's week.
type Exception struct {
	Date string
	Kind ExceptionKind
	Span *Span
}

// SpanProblem checks the times of a weekly window or an exception.
func SpanProblem(s Span) string {
	if s.Start < 0 || s.End > EndOfDay || s.End <= s.Start {
		return "Jam selesai harus setelah jam mulai"
	}
	return ""
}

// Interval is an instant range [Start, End).
type Interval struct{ Start, End time.Time }

func (a Interval) overlaps(b Interval) bool { return a.Start.Before(b.End) && b.Start.Before(a.End) }

// isoWeekday of a WIB date.
func isoWeekday(day time.Time) int {
	if wd := int(day.Weekday()); wd != 0 {
		return wd
	}
	return 7
}

// DayWindows is when the coach takes PT on date (YYYY-MM-DD, WIB): the
// weekly windows of its weekday, minus Off exceptions, plus Extra ones,
// merged and sorted. A bad date yields nothing.
func DayWindows(date string, weekly []WeeklyWindow, exceptions []Exception) []Interval {
	day, err := time.ParseInLocation(time.DateOnly, date, WIB)
	if err != nil {
		return nil
	}
	var spans []Span
	for _, w := range weekly {
		if w.Weekday == isoWeekday(day) {
			spans = append(spans, w.Span)
		}
	}
	for _, e := range exceptions {
		if e.Date == date && e.Kind == Off {
			if e.Span == nil {
				spans = nil
				break
			}
			spans = subtract(spans, *e.Span)
		}
	}
	for _, e := range exceptions {
		if e.Date == date && e.Kind == Extra && e.Span != nil {
			spans = append(spans, *e.Span)
		}
	}
	out := make([]Interval, 0, len(spans))
	for _, s := range merge(spans) {
		out = append(out, Interval{
			Start: day.Add(time.Duration(s.Start) * time.Minute),
			End:   day.Add(time.Duration(s.End) * time.Minute),
		})
	}
	return out
}

func subtract(spans []Span, cut Span) []Span {
	var out []Span
	for _, s := range spans {
		if cut.End <= s.Start || cut.Start >= s.End {
			out = append(out, s)
			continue
		}
		if s.Start < cut.Start {
			out = append(out, Span{s.Start, cut.Start})
		}
		if cut.End < s.End {
			out = append(out, Span{cut.End, s.End})
		}
	}
	return out
}

func merge(spans []Span) []Span {
	slices.SortFunc(spans, func(a, b Span) int { return int(a.Start - b.Start) })
	var out []Span
	for _, s := range spans {
		if n := len(out); n > 0 && s.Start <= out[n-1].End {
			out[n-1].End = max(out[n-1].End, s.End)
			continue
		}
		out = append(out, s)
	}
	return out
}

// Fits reports whether [start, end) lies inside one of the windows.
func Fits(windows []Interval, start, end time.Time) bool {
	for _, w := range windows {
		if !start.Before(w.Start) && !end.After(w.End) {
			return true
		}
	}
	return false
}

// FreeSlots lists the starts, step apart from each window's start, of
// sessions of duration that fit a window, begin no earlier than earliest
// and overlap nothing in busy.
func FreeSlots(windows, busy []Interval, duration, step time.Duration, earliest time.Time) []time.Time {
	var out []time.Time
	for _, w := range windows {
		for start := w.Start; !start.Add(duration).After(w.End); start = start.Add(step) {
			slot := Interval{start, start.Add(duration)}
			if start.Before(earliest) || slices.ContainsFunc(busy, slot.overlaps) {
				continue
			}
			out = append(out, start)
		}
	}
	return out
}
