// Package domain holds the pure rules of gym-desk: report periods in WIB
// days and the roll-ups of class sessions into the report tables.
package domain

import (
	"errors"
	"time"
)

// WIB is the gym's calendar: days and hours in reports are Asia/Jakarta.
var WIB = time.FixedZone("WIB", 7*60*60)

const dateLayout = "2006-01-02"

// Period is [From, To) on WIB midnights.
type Period struct {
	From, To time.Time
}

// Days is the number of calendar days in the period.
func (p Period) Days() int { return int(p.To.Sub(p.From).Hours() / 24) }

// Previous is the period of the same length that ends where p starts.
func (p Period) Previous() Period {
	return Period{From: p.From.AddDate(0, 0, -p.Days()), To: p.From}
}

// DayKeys lists every day of the period as YYYY-MM-DD.
func (p Period) DayKeys() []string {
	keys := make([]string, 0, p.Days())
	for d := p.From; d.Before(p.To); d = d.AddDate(0, 0, 1) {
		keys = append(keys, d.Format(dateLayout))
	}
	return keys
}

// ErrPeriod is a range the reports refuse.
var ErrPeriod = errors.New("Rentang tanggal tidak valid")

// ParsePeriod reads from and to as inclusive YYYY-MM-DD WIB days. A missing
// to is today; a missing from is defaultDays days back to that to. A range
// that ends before it starts or spans more than maxDays days is ErrPeriod.
func ParsePeriod(from, to string, now time.Time, defaultDays, maxDays int) (Period, error) {
	today := DayStart(now)
	last := today
	if to != "" {
		d, err := time.ParseInLocation(dateLayout, to, WIB)
		if err != nil {
			return Period{}, ErrPeriod
		}
		last = d
	}
	first := last.AddDate(0, 0, 1-defaultDays)
	if from != "" {
		d, err := time.ParseInLocation(dateLayout, from, WIB)
		if err != nil {
			return Period{}, ErrPeriod
		}
		first = d
	}
	p := Period{From: first, To: last.AddDate(0, 0, 1)}
	if !p.From.Before(p.To) || p.Days() > maxDays {
		return Period{}, ErrPeriod
	}
	return p, nil
}

// DayStart is WIB midnight of t's day.
func DayStart(t time.Time) time.Time {
	y, m, d := t.In(WIB).Date()
	return time.Date(y, m, d, 0, 0, 0, 0, WIB)
}

// Rate is part/whole, 0 when whole is 0.
func Rate(part, whole int) float64 {
	if whole == 0 {
		return 0
	}
	return float64(part) / float64(whole)
}
