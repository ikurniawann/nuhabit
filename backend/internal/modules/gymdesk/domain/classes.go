package domain

import (
	"cmp"
	"slices"
	"time"
)

// SessionStat is one class session with its booking counts.
type SessionStat struct {
	ID            string
	ClassTypeID   string
	ClassTypeName string
	CoachID       *string
	CoachName     *string
	StartsAt      time.Time
	EndsAt        time.Time
	Capacity      int
	// Booked holds a seat: confirmed, checked in, completed or no-show.
	Booked     int
	CheckedIn  int
	NoShow     int
	LateCancel int
	// Bookings is every booking that held or asked for a seat, cancelled
	// ones included; the base of the late-cancel rate.
	Bookings int
}

func (s SessionStat) fill() float64 {
	if s.Capacity <= 0 {
		return 0
	}
	return min(1, float64(s.Booked)/float64(s.Capacity))
}

// ClassTotals are the attendance totals of the period.
type ClassTotals struct {
	Sessions       int     `json:"sessions"`
	CheckedIn      int     `json:"checked_in"`
	NoShow         int     `json:"no_show"`
	LateCancel     int     `json:"late_cancel"`
	Bookings       int     `json:"bookings"`
	NoShowRate     float64 `json:"no_show_rate"`
	LateCancelRate float64 `json:"late_cancel_rate"`
	AvgFill        float64 `json:"avg_fill"`
}

// DayAttendance is one WIB day of the attendance chart.
type DayAttendance struct {
	Day        string `json:"day"`
	CheckedIn  int    `json:"checked_in"`
	NoShow     int    `json:"no_show"`
	LateCancel int    `json:"late_cancel"`
}

// GroupStat is a class type or a coach over the period.
type GroupStat struct {
	ID             string  `json:"id"`
	Name           string  `json:"name"`
	Sessions       int     `json:"sessions"`
	Hours          float64 `json:"hours"`
	CheckedIn      int     `json:"checked_in"`
	NoShow         int     `json:"no_show"`
	LateCancel     int     `json:"late_cancel"`
	Bookings       int     `json:"bookings"`
	AvgFill        float64 `json:"avg_fill"`
	NoShowRate     float64 `json:"no_show_rate"`
	LateCancelRate float64 `json:"late_cancel_rate"`
}

// HeatCell is the average fill of the sessions that start in one WIB
// weekday (1 Monday to 7 Sunday) and hour.
type HeatCell struct {
	Weekday  int     `json:"weekday"`
	Hour     int     `json:"hour"`
	Sessions int     `json:"sessions"`
	AvgFill  float64 `json:"avg_fill"`
}

// ClassReport is attendance, occupancy and coach utilisation.
type ClassReport struct {
	Totals       ClassTotals     `json:"totals"`
	PerDay       []DayAttendance `json:"per_day"`
	PerClassType []GroupStat     `json:"per_class_type"`
	PerCoach     []GroupStat     `json:"per_coach"`
	Heatmap      []HeatCell      `json:"heatmap"`
}

// NoCoachName labels sessions without a coach.
const NoCoachName = "Tanpa coach"

type group struct {
	stat  GroupStat
	fills float64
}

func (g *group) add(s SessionStat) {
	g.stat.Sessions++
	g.stat.Hours += s.EndsAt.Sub(s.StartsAt).Hours()
	g.stat.CheckedIn += s.CheckedIn
	g.stat.NoShow += s.NoShow
	g.stat.LateCancel += s.LateCancel
	g.stat.Bookings += s.Bookings
	g.fills += s.fill()
}

func (g *group) done() GroupStat {
	out := g.stat
	out.AvgFill = g.fills / float64(max(1, out.Sessions))
	out.NoShowRate = Rate(out.NoShow, out.CheckedIn+out.NoShow)
	out.LateCancelRate = Rate(out.LateCancel, out.Bookings)
	return out
}

// RollUpClasses folds the sessions of p that started before now into the
// report. Sessions still to come are left out: their seats are not settled.
func RollUpClasses(sessions []SessionStat, p Period, now time.Time) ClassReport {
	days := map[string]*DayAttendance{}
	perDay := make([]DayAttendance, 0, p.Days())
	for _, key := range p.DayKeys() {
		perDay = append(perDay, DayAttendance{Day: key})
	}
	for i := range perDay {
		days[perDay[i].Day] = &perDay[i]
	}
	types, coaches := map[string]*group{}, map[string]*group{}
	type slot struct{ weekday, hour int }
	heat := map[slot]*group{}
	var all group

	for _, s := range sessions {
		if !s.StartsAt.Before(now) || s.StartsAt.Before(p.From) || !s.StartsAt.Before(p.To) {
			continue
		}
		all.add(s)
		local := s.StartsAt.In(WIB)
		if d := days[local.Format(dateLayout)]; d != nil {
			d.CheckedIn += s.CheckedIn
			d.NoShow += s.NoShow
			d.LateCancel += s.LateCancel
		}
		groupOf(types, s.ClassTypeID, s.ClassTypeName).add(s)
		coachID, coachName := "", NoCoachName
		if s.CoachID != nil {
			coachID = *s.CoachID
			if s.CoachName != nil {
				coachName = *s.CoachName
			}
		}
		groupOf(coaches, coachID, coachName).add(s)
		weekday := int(local.Weekday())
		if weekday == 0 {
			weekday = 7
		}
		groupOf(heat, slot{weekday, local.Hour()}, "").add(s)
	}

	totals := all.done()
	report := ClassReport{
		Totals: ClassTotals{
			Sessions: totals.Sessions, CheckedIn: totals.CheckedIn, NoShow: totals.NoShow,
			LateCancel: totals.LateCancel, Bookings: totals.Bookings, NoShowRate: totals.NoShowRate,
			LateCancelRate: totals.LateCancelRate, AvgFill: totals.AvgFill,
		},
		PerDay:       perDay,
		PerClassType: rank(types),
		PerCoach:     rank(coaches),
		Heatmap:      make([]HeatCell, 0, len(heat)),
	}
	for key, g := range heat {
		report.Heatmap = append(report.Heatmap, HeatCell{Weekday: key.weekday, Hour: key.hour, Sessions: g.stat.Sessions, AvgFill: g.done().AvgFill})
	}
	slices.SortFunc(report.Heatmap, func(a, b HeatCell) int {
		return cmp.Or(cmp.Compare(a.Weekday, b.Weekday), cmp.Compare(a.Hour, b.Hour))
	})
	return report
}

func groupOf[K comparable](m map[K]*group, key K, name string) *group {
	g := m[key]
	if g == nil {
		g = &group{}
		if id, ok := any(key).(string); ok {
			g.stat.ID = id
		}
		g.stat.Name = name
		m[key] = g
	}
	return g
}

// rank orders groups by check-ins, then name.
func rank(m map[string]*group) []GroupStat {
	out := make([]GroupStat, 0, len(m))
	for _, g := range m {
		out = append(out, g.done())
	}
	slices.SortFunc(out, func(a, b GroupStat) int {
		return cmp.Or(cmp.Compare(b.CheckedIn, a.CheckedIn), cmp.Compare(a.Name, b.Name))
	})
	return out
}
