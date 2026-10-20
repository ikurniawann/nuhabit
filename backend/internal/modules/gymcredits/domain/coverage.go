package domain

import (
	"slices"
	"sort"
	"time"
)

// Demand is what one booking will draw from the ledger at check-in: Credits
// for a class of ClassTypeID that starts At.
type Demand struct {
	ClassTypeID string
	Credits     int
	At          time.Time
}

// CanCover reports whether the lots can pay for every demand. It replays
// the deductions the ledger will make, class start order first, each with
// the priority of AllocateDeduction: lots restricted to a list naming the
// class, then unrestricted lots, earliest expiry first. A lot must still be
// live when the class starts. A set that some other lot assignment could
// pay but the ledger's order would not is refused: check-in deducts in that
// order.
func CanCover(remainders []LotRemainder, coverage map[string][]string, demands []Demand, now time.Time) bool {
	left := slices.Clone(remainders)
	index := make(map[string]int, len(left))
	for i, r := range left {
		index[r.Lot.ID] = i
	}
	ordered := slices.Clone(demands)
	sort.SliceStable(ordered, func(i, j int) bool { return ordered[i].At.Before(ordered[j].At) })
	for _, d := range ordered {
		at := d.At
		if at.Before(now) {
			at = now
		}
		need := d.Credits
		for _, r := range usableLots(left, coverage, d.ClassTypeID, at) {
			if need <= 0 {
				break
			}
			take := min(r.Remaining, need)
			left[index[r.Lot.ID]].Remaining -= take
			need -= take
		}
		if need > 0 {
			return false
		}
	}
	return true
}
