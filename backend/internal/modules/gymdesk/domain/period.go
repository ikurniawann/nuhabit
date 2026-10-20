// Package domain holds the pure rules of gym-desk: report periods in local
// days and the roll-ups of class sessions into the report tables.
package domain

import (
	"errors"
	"time"

	"nuhabit/backend/internal/platform/localtime"
)

const dateLayout = "2006-01-02"

// Period is [From, To) on midnights of Zone: the branch filter's zone, or
// Jakarta for every branch. Days and hours in reports read in Zone.
type Period struct {
	From, To time.Time
	Zone     *time.Location
}

// Days is the number of calendar days in the period.
func (p Period) Days() int { return int(p.To.Sub(p.From).Hours() / 24) }

// Previous is the period of the same length that ends where p starts.
func (p Period) Previous() Period {
	return Period{From: p.From.AddDate(0, 0, -p.Days()), To: p.From, Zone: p.Zone}
}

// DayKeys lists every day of the period as YYYY-MM-DD.
func (p Period) DayKeys() []string {
	keys := make([]string, 0, p.Days())
	for d := p.From; d.Before(p.To); d = d.AddDate(0, 0, 1) {
		keys = append(keys, d.Format(dateLayout))
	}
	return keys
}

// ZoneName is the IANA name of the period's zone, for SQL and responses.
func (p Period) ZoneName() string { return localtime.Name(p.Zone) }

// ErrPeriod is a range the reports refuse.
var ErrPeriod = errors.New("Rentang tanggal tidak valid")

// ParsePeriod reads from and to as inclusive YYYY-MM-DD days in zone. A
// missing to is today; a missing from is defaultDays days back to that to.
// A range that ends before it starts or spans more than maxDays days is
// ErrPeriod.
func ParsePeriod(from, to string, now time.Time, defaultDays, maxDays int, zone *time.Location) (Period, error) {
	if zone == nil {
		zone = localtime.Jakarta
	}
	last := localtime.DayStart(now, zone)
	if to != "" {
		d, err := localtime.ParseDay(to, zone)
		if err != nil {
			return Period{}, ErrPeriod
		}
		last = d
	}
	first := last.AddDate(0, 0, 1-defaultDays)
	if from != "" {
		d, err := localtime.ParseDay(from, zone)
		if err != nil {
			return Period{}, ErrPeriod
		}
		first = d
	}
	p := Period{From: first, To: last.AddDate(0, 0, 1), Zone: zone}
	if !p.From.Before(p.To) || p.Days() > maxDays {
		return Period{}, ErrPeriod
	}
	return p, nil
}

// Rate is part/whole, 0 when whole is 0.
func Rate(part, whole int) float64 {
	if whole == 0 {
		return 0
	}
	return float64(part) / float64(whole)
}
