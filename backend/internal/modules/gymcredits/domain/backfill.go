package domain

import "sort"

// Backfill of lot ids on entries written before deductions recorded their
// lot (cmd/gym-opening-balance). Such entries form the pool that
// LotRemainders allocates FIFO; pinning them to lots the same way leaves
// every lot's remaining credits as they are, and the journals of later
// moves then value the right lot.

// Pin gives Credits of an unpinned entry to LotID. An entry split over
// several lots gets several pins; the first keeps the entry's row.
type Pin struct {
	EntryID string
	LotID   string
	Credits int
}

// BackfillPlan is the pins for one member. Unpinned lists the entries no
// lot could take. Consistent is false when applying the pins would change
// a lot's remaining credits, in which case nothing should be written.
type BackfillPlan struct {
	Pins       []Pin
	Unpinned   []string
	Consistent bool
}

// PlanBackfill pins the member's pool entries in the order they were
// written: credits that left the pool come off the lots earliest expiry
// first, credits that came back (a class refund) return to the lots the
// same booking drew from, last first. An entry that was reversed is pinned
// only when one lot takes all of it, and its reversal follows it.
func PlanBackfill(lots []Lot, entries []Entry, reversed map[string]bool) BackfillPlan {
	sorted := append([]Lot(nil), lots...)
	sort.SliceStable(sorted, func(i, j int) bool {
		a, b := sorted[i], sorted[j]
		if !a.ExpiresAt.Equal(b.ExpiresAt) {
			return a.ExpiresAt.Before(b.ExpiresAt)
		}
		return a.CreatedAt.Before(b.CreatedAt)
	})
	taken := map[string]int{} // credits out of each lot (pinned entries and pins so far)
	for _, e := range entries {
		if e.LotID != "" && !createsLot(e) {
			taken[e.LotID] -= e.Amount
		}
	}
	bySource := map[string][]Pin{} // pins of the negative entries of a booking, in order
	pinsOf := map[string][]Pin{}
	var plan BackfillPlan
	pin := func(e Entry, pins []Pin) {
		plan.Pins = append(plan.Pins, pins...)
		pinsOf[e.ID] = pins
		if e.Amount < 0 && e.SourceID != "" {
			bySource[e.SourceID] = append(bySource[e.SourceID], pins...)
		}
		for _, p := range pins {
			if e.Amount < 0 {
				taken[p.LotID] += p.Credits
			} else {
				taken[p.LotID] -= p.Credits
			}
		}
	}
	for _, e := range entries {
		if e.LotID != "" || createsLot(e) || e.Amount == 0 {
			continue
		}
		var pins []Pin
		switch {
		case e.Type == Reversal && e.ReversesEntryID != "":
			if original := pinsOf[e.ReversesEntryID]; len(original) == 1 {
				pins = []Pin{{EntryID: e.ID, LotID: original[0].LotID, Credits: max(e.Amount, -e.Amount)}}
			}
		case e.Amount < 0:
			left := -e.Amount
			for _, lot := range sorted {
				if left == 0 {
					break
				}
				if take := min(max(0, lot.Credits-taken[lot.ID]), left); take > 0 {
					pins = append(pins, Pin{EntryID: e.ID, LotID: lot.ID, Credits: take})
					left -= take
				}
			}
			if left > 0 || (reversed[e.ID] && len(pins) > 1) {
				pins = nil
			}
		default:
			left := e.Amount
			drawn := bySource[e.SourceID]
			for i := len(drawn) - 1; i >= 0 && left > 0; i-- {
				if give := min(taken[drawn[i].LotID], left); give > 0 {
					pins = append(pins, Pin{EntryID: e.ID, LotID: drawn[i].LotID, Credits: give})
					left -= give
				}
			}
			if left > 0 {
				pins = nil
			}
		}
		if len(pins) == 0 {
			plan.Unpinned = append(plan.Unpinned, e.ID)
			continue
		}
		pin(e, pins)
	}
	plan.Consistent = sameRemainders(lots, entries, ApplyPins(entries, plan.Pins))
	return plan
}

// ApplyPins is entries with the pins applied: a pinned entry carries its
// lot, a split entry becomes one entry per pin.
func ApplyPins(entries []Entry, pins []Pin) []Entry {
	byEntry := map[string][]Pin{}
	for _, p := range pins {
		byEntry[p.EntryID] = append(byEntry[p.EntryID], p)
	}
	out := make([]Entry, 0, len(entries))
	for _, e := range entries {
		ps, ok := byEntry[e.ID]
		if !ok {
			out = append(out, e)
			continue
		}
		sign := 1
		if e.Amount < 0 {
			sign = -1
		}
		for _, p := range ps {
			part := e
			part.LotID, part.Amount = p.LotID, sign*p.Credits
			out = append(out, part)
		}
	}
	return out
}

func sameRemainders(lots []Lot, before, after []Entry) bool {
	was := map[string]int{}
	for _, r := range LotRemainders(lots, before) {
		was[r.Lot.ID] = r.Remaining
	}
	for _, r := range LotRemainders(lots, after) {
		if was[r.Lot.ID] != r.Remaining {
			return false
		}
	}
	return true
}
