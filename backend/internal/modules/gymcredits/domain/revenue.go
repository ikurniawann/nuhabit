package domain

import (
	"math"
	"time"
)

// Pass revenue is released by day; credits are valued in valuation.go.

// PassRevenueDue is the pass revenue recognised through calendar day
// through: the price spread evenly over the days from startDay to endDay,
// one day for each day that has started. The last day recognises the whole
// price. Days are dates at midnight in one zone.
func PassRevenueDue(totalIdr float64, startDay, endDay, through time.Time) float64 {
	days := int(math.Round(endDay.Sub(startDay).Hours() / 24))
	started := int(math.Round(through.Sub(startDay).Hours()/24)) + 1
	switch {
	case started <= 0 || totalIdr <= 0:
		return 0
	case days <= 0 || started >= days:
		return totalIdr
	}
	return round2(totalIdr * float64(started) / float64(days))
}

func round2(x float64) float64 { return math.Round(x*100) / 100 }
