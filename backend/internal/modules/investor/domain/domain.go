// Package domain holds the pure rules of the investor portal: revenue
// streams, the daily revenue roll-up and the period comparisons behind the
// KPI tiles.
package domain

import (
	"time"
)

// Revenue streams. Every rupiah of revenue lands in exactly one.
const (
	StreamPackages = "packages"
	StreamPasses   = "passes"
	StreamPT       = "pt"
	StreamPOS      = "pos"
)

// Streams lists the streams in display order.
var Streams = []string{StreamPackages, StreamPasses, StreamPT, StreamPOS}

// Stream classifies a gym package sale: a package that covers personal
// training is PT revenue, a pass is pass revenue, the rest is packages.
func Stream(kind string, coversPersonal bool) string {
	switch {
	case coversPersonal:
		return StreamPT
	case kind == "pass":
		return StreamPasses
	}
	return StreamPackages
}

// SaleRow is revenue of one stream and branch on one local day: gym
// package sales net of refunds, or POS orders.
type SaleRow struct {
	Day      string
	Stream   string
	BranchID string
	Amount   float64
}

// DayRevenue is one local day of the revenue chart.
type DayRevenue struct {
	Day    string             `json:"day"`
	Total  float64            `json:"total"`
	Stream map[string]float64 `json:"streams"`
	Branch map[string]float64 `json:"branches"`
}

// Daily is the revenue of a span of days indexed by day key.
type Daily struct {
	Days  []DayRevenue
	index map[string]int
}

// RollUpDaily folds sale rows into one entry per day of days, in order.
// Rows outside days are dropped.
func RollUpDaily(days []string, rows []SaleRow) Daily {
	d := Daily{Days: make([]DayRevenue, 0, len(days)), index: make(map[string]int, len(days))}
	for i, day := range days {
		entry := DayRevenue{Day: day, Stream: map[string]float64{}, Branch: map[string]float64{}}
		for _, s := range Streams {
			entry.Stream[s] = 0
		}
		d.Days = append(d.Days, entry)
		d.index[day] = i
	}
	for _, r := range rows {
		i, ok := d.index[r.Day]
		if !ok {
			continue
		}
		e := &d.Days[i]
		e.Total += r.Amount
		e.Stream[r.Stream] += r.Amount
		e.Branch[r.BranchID] += r.Amount
	}
	return d
}

// Sum totals the days from from to to inclusive (day keys), by stream.
func (d Daily) Sum(from, to string) (total float64, byStream map[string]float64) {
	byStream = map[string]float64{}
	for _, s := range Streams {
		byStream[s] = 0
	}
	for _, e := range d.Days {
		if e.Day < from || e.Day > to {
			continue
		}
		total += e.Total
		for s, v := range e.Stream {
			byStream[s] += v
		}
	}
	return total, byStream
}

// Range returns the days from from to to inclusive, in order.
func (d Daily) Range(from, to string) []DayRevenue {
	out := []DayRevenue{}
	for _, e := range d.Days {
		if e.Day >= from && e.Day <= to {
			out = append(out, e)
		}
	}
	return out
}

// Compared is a figure next to the same figure of the previous period.
type Compared struct {
	Value    float64 `json:"value"`
	Previous float64 `json:"previous"`
	// Change is the relative change, nil when the previous value is zero.
	Change *float64 `json:"change"`
}

// Compare builds the comparison of value against previous.
func Compare(value, previous float64) Compared {
	c := Compared{Value: value, Previous: previous}
	if previous != 0 {
		change := (value - previous) / previous
		c.Change = &change
	}
	return c
}

// Rate is part over whole, 0 when whole is 0.
func Rate(part, whole float64) float64 {
	if whole == 0 {
		return 0
	}
	return part / whole
}

// DayKeys lists the days from from to to (inclusive, in zone) as YYYY-MM-DD.
func DayKeys(from, to time.Time, zone *time.Location) []string {
	var out []string
	for d := from.In(zone); !d.After(to.In(zone)); d = d.AddDate(0, 0, 1) {
		out = append(out, d.Format(time.DateOnly))
	}
	return out
}

// Windows are the comparison spans of the KPI tiles, as inclusive day keys
// in the report zone: today against yesterday, month to date against the
// same number of days of the previous month, year to date against the same
// span of the previous year.
type Windows struct {
	Today, Yesterday                 string
	MonthFrom, PrevMonthFrom, PrevTo string
	YearFrom, PrevYearFrom, PrevYTo  string
}

// WindowsAt derives the windows from now in zone.
func WindowsAt(now time.Time, zone *time.Location) Windows {
	t := now.In(zone)
	today := time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, zone)
	key := func(d time.Time) string { return d.Format(time.DateOnly) }
	monthStart := time.Date(t.Year(), t.Month(), 1, 0, 0, 0, 0, zone)
	prevMonthStart := monthStart.AddDate(0, -1, 0)
	yearStart := time.Date(t.Year(), 1, 1, 0, 0, 0, 0, zone)
	prevYearStart := yearStart.AddDate(-1, 0, 0)
	// The previous span has the same number of days, capped at the end of
	// its own month or year (31 October against all of September).
	prevTo := prevMonthStart.AddDate(0, 0, t.Day()-1)
	if !prevTo.Before(monthStart) {
		prevTo = monthStart.AddDate(0, 0, -1)
	}
	prevYTo := prevYearStart.AddDate(0, 0, int(today.Sub(yearStart).Hours()/24))
	if !prevYTo.Before(yearStart) {
		prevYTo = yearStart.AddDate(0, 0, -1)
	}
	return Windows{
		Today: key(today), Yesterday: key(today.AddDate(0, 0, -1)),
		MonthFrom: key(monthStart), PrevMonthFrom: key(prevMonthStart), PrevTo: key(prevTo),
		YearFrom: key(yearStart), PrevYearFrom: key(prevYearStart), PrevYTo: key(prevYTo),
	}
}

// MonthSpan is the first day of the month months-1 months before now and
// the last day of the current month, in zone.
func MonthSpan(now time.Time, months int, zone *time.Location) (from, to time.Time) {
	t := now.In(zone)
	to = time.Date(t.Year(), t.Month()+1, 1, 0, 0, 0, 0, zone).AddDate(0, 0, -1)
	from = time.Date(t.Year(), t.Month(), 1, 0, 0, 0, 0, zone).AddDate(0, -(months - 1), 0)
	return from, to
}
