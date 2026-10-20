// Package localtime is the gym's wall clock: the time zone of a branch,
// calendar days in that zone and the Indonesian date formats notifications
// use. A branch stores an IANA name in configuration.branches.timezone;
// member-level rules without a branch (referral month, transfer cap, HYROX
// year) use Jakarta. Every function taking a *time.Location reads nil as
// Jakarta, so a zero-value struct formats as before.
package localtime

import (
	"context"
	"strconv"
	"sync"
	"time"

	"nuhabit/backend/internal/platform/database"
)

// Default is the zone of a branch without one and of member-level rules.
const Default = "Asia/Jakarta"

// Names are the zones a branch may use, west to east. The list matches the
// CHECK on configuration.branches.timezone.
var Names = []string{"Asia/Jakarta", "Asia/Makassar", "Asia/Jayapura"}

// None of the supported zones observes daylight saving, so fixed offsets
// give the same wall clock as tzdata and need no lookup.
var fixed = map[string]*time.Location{
	"Asia/Jakarta":  time.FixedZone("WIB", 7*3600),
	"Asia/Makassar": time.FixedZone("WITA", 8*3600),
	"Asia/Jayapura": time.FixedZone("WIT", 9*3600),
}

// Jakarta is Asia/Jakarta (WIB, UTC+7).
var Jakarta = fixed[Default]

var loaded sync.Map // name -> *time.Location

// Valid reports whether name is a zone a branch may use.
func Valid(name string) bool { return fixed[name] != nil }

// Zone is the location for an IANA name. The supported zones are fixed
// offsets; another name is loaded from tzdata once and cached. An empty or
// unknown name is Jakarta.
func Zone(name string) *time.Location {
	if loc := fixed[name]; loc != nil {
		return loc
	}
	if name == "" {
		return Jakarta
	}
	if loc, ok := loaded.Load(name); ok {
		return loc.(*time.Location)
	}
	loc, err := time.LoadLocation(name)
	if err != nil {
		loc = Jakarta
	}
	loaded.Store(name, loc)
	return loc
}

// BranchZone reads the zone of a branch; a nil or unknown branch is Jakarta.
func BranchZone(ctx context.Context, q database.Querier, branchID *string) (*time.Location, error) {
	if branchID == nil {
		return Jakarta, nil
	}
	var name string
	err := q.QueryRow(ctx, `SELECT timezone FROM configuration.branches WHERE id = $1`, *branchID).Scan(&name)
	if database.IsNoRows(err) {
		return Jakarta, nil
	}
	if err != nil {
		return nil, err
	}
	return Zone(name), nil
}

// Name is the IANA name of loc, the value APIs return as "timezone".
func Name(loc *time.Location) string {
	loc = or(loc)
	for name, l := range fixed {
		if l == loc {
			return name
		}
	}
	return loc.String()
}

func or(loc *time.Location) *time.Location {
	if loc == nil {
		return Jakarta
	}
	return loc
}

// Abbrev is the Indonesian short name of loc: WIB, WITA or WIT.
func Abbrev(loc *time.Location) string {
	name, _ := time.Date(2026, 1, 1, 0, 0, 0, 0, or(loc)).Zone()
	return name
}

// suffix is " WITA" or " WIT" outside Jakarta and empty in Jakarta, so
// Jakarta copy reads as before.
func suffix(loc *time.Location) string {
	if or(loc) == Jakarta {
		return ""
	}
	return " " + Abbrev(loc)
}

// DayStart is midnight of t's calendar day in loc.
func DayStart(t time.Time, loc *time.Location) time.Time {
	loc = or(loc)
	y, m, d := t.In(loc).Date()
	return time.Date(y, m, d, 0, 0, 0, 0, loc)
}

// DayBounds is t's calendar day in loc as [start, end).
func DayBounds(t time.Time, loc *time.Location) (start, end time.Time) {
	start = DayStart(t, loc)
	return start, start.AddDate(0, 0, 1)
}

// DayKey is t's calendar date in loc as YYYY-MM-DD.
func DayKey(t time.Time, loc *time.Location) string { return t.In(or(loc)).Format(time.DateOnly) }

// ParseDay reads YYYY-MM-DD as midnight of that date in loc.
func ParseDay(s string, loc *time.Location) (time.Time, error) {
	return time.ParseInLocation(time.DateOnly, s, or(loc))
}

// WeekStart is Monday 00:00 in loc of the week holding t.
func WeekStart(t time.Time, loc *time.Location) time.Time {
	d := DayStart(t, loc)
	back := (int(d.Weekday()) + 6) % 7
	return d.AddDate(0, 0, -back)
}

var (
	weekdaysShort = [...]string{"Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"}
	weekdaysLong  = [...]string{"Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"}
	months        = [...]string{"Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"}
)

// Format renders an instant as "Sab, 24 Okt, 18.00", the way
// toLocaleString("id-ID", {weekday, day, month: "short", hour, minute})
// does, with " WITA" or " WIT" appended outside Jakarta.
func Format(t time.Time, loc *time.Location) string {
	return day(t, loc) + ", " + clock(t, loc) + suffix(loc)
}

// FormatSpan renders a slot as "Sab, 24 Okt, 18.00–19.00", with the zone
// outside Jakarta.
func FormatSpan(start, end time.Time, loc *time.Location) string {
	return day(start, loc) + ", " + clock(start, loc) + "–" + clock(end, loc) + suffix(loc)
}

// FormatDate renders a date as "21 Okt 2026".
func FormatDate(t time.Time, loc *time.Location) string {
	w := t.In(or(loc))
	return strconv.Itoa(w.Day()) + " " + months[w.Month()-1] + " " + strconv.Itoa(w.Year())
}

// FormatLongDate renders a date as "Senin, 5 Okt 2026".
func FormatLongDate(t time.Time, loc *time.Location) string {
	return weekdaysLong[t.In(or(loc)).Weekday()] + ", " + FormatDate(t, loc)
}

// FormatDateTime renders "21 Okt 2026 pukul 14.00 WIB"; the zone is always named.
func FormatDateTime(t time.Time, loc *time.Location) string {
	return FormatDate(t, loc) + " pukul " + clock(t, loc) + " " + Abbrev(loc)
}

// day is "Sab, 24 Okt".
func day(t time.Time, loc *time.Location) string {
	w := t.In(or(loc))
	return weekdaysShort[w.Weekday()] + ", " + strconv.Itoa(w.Day()) + " " + months[w.Month()-1]
}

func clock(t time.Time, loc *time.Location) string { return t.In(or(loc)).Format("15.04") }
