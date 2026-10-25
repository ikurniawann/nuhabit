// Package domain holds the gym loyalty rules as pure Go: membership tiers
// from 12-month spending with their hold period, the perks engine that
// merges them with the XP tiers, member status, attendance XP (off-peak,
// streaks, early renewal) and the attendance leaderboard. Port of the
// behaviour in the older TS fork (lib/studio/membership.ts, loyalty.ts).
//
// Two ladders coexist. Membership tiers (this package) follow rupiah spent in
// the last 365 days and carry booking and POS perks. Progress tiers
// (crm.crm_membership_tiers) follow lifetime XP and give a POS discount only.
// Merge takes the better value of each perk, so a member never loses a
// discount the XP ladder already gave.
package domain

import (
	"slices"
	"strings"
	"time"
)

// Day is a calendar date in the member zone (Jakarta), YYYY-MM-DD. Days
// compare as strings.
type Day string

// DayOf is t's date in loc.
func DayOf(t time.Time, loc *time.Location) Day { return Day(t.In(loc).Format(time.DateOnly)) }

func (d Day) time() time.Time {
	t, _ := time.Parse(time.DateOnly, string(d))
	return t
}

// AddDays moves the date by n days.
func (d Day) AddDays(n int) Day { return Day(d.time().AddDate(0, 0, n).Format(time.DateOnly)) }

// AddMonths moves the date by n calendar months, clamped to the end of the
// target month: 31 Jan + 1 month is 28 or 29 Feb, 29 Feb + 12 months is 28 Feb.
func (d Day) AddMonths(n int) Day {
	t := d.time()
	first := time.Date(t.Year(), t.Month(), 1, 0, 0, 0, 0, time.UTC).AddDate(0, n, 0)
	last := first.AddDate(0, 1, -1).Day()
	return Day(first.AddDate(0, 0, min(t.Day(), last)-1).Format(time.DateOnly))
}

// SpendWindowDays is the rolling spending window, today included.
const SpendWindowDays = 365

// SpendWindow is the first and last day of the spending window ending today.
func SpendWindow(today Day) (from, to Day) { return today.AddDays(-(SpendWindowDays - 1)), today }

// Tier is one rung of the membership ladder.
type Tier struct {
	ID                string   `json:"id"`
	Name              string   `json:"name"`
	Color             *string  `json:"color"`
	MinSpend          float64  `json:"min_spend_idr"`
	DiscountPercent   float64  `json:"discount_percent"`
	EarlyBookingDays  int      `json:"early_booking_days"`
	CancelWindowHours *int     `json:"cancel_window_hours"`
	WaitlistPriority  bool     `json:"waitlist_priority"`
	Perks             []string `json:"perks"`
}

// SortTiers orders the ladder from the lowest threshold up.
func SortTiers(tiers []Tier) []Tier {
	out := slices.Clone(tiers)
	slices.SortStableFunc(out, func(a, b Tier) int {
		switch {
		case a.MinSpend < b.MinSpend:
			return -1
		case a.MinSpend > b.MinSpend:
			return 1
		}
		return 0
	})
	return out
}

// Rank is the tier's place on the ladder, 1 for the lowest; 0 when the
// tier is not on it.
func Rank(tiers []Tier, id string) int {
	for i, t := range SortTiers(tiers) {
		if t.ID == id {
			return i + 1
		}
	}
	return 0
}

// EarnedTier is the highest tier whose threshold spend reaches; nil below
// the lowest.
func EarnedTier(tiers []Tier, spend float64) *Tier {
	sorted := SortTiers(tiers)
	for i := len(sorted) - 1; i >= 0; i-- {
		if spend >= sorted[i].MinSpend {
			return &sorted[i]
		}
	}
	return nil
}

func find(tiers []Tier, id *string) *Tier {
	if id == nil {
		return nil
	}
	for i := range tiers {
		if tiers[i].ID == *id {
			return &tiers[i]
		}
	}
	return nil
}

// State is the stored tier of a member.
type State struct {
	TierID     *string
	ValidUntil *Day
}

// Change is a move up or down the ladder; From or To is nil for no tier.
type Change struct {
	Direction string
	From, To  *Tier
}

// Evaluation is the tier a member holds after an evaluation.
type Evaluation struct {
	Tier       *Tier
	ValidUntil *Day
	Change     *Change
}

// Evaluate places a member on the ladder from their spending today:
//   - reaching a tier at or above the stored one takes it at once and holds
//     it for holdMonths from today;
//   - otherwise the stored tier holds until its valid_until;
//   - after that the member drops to the tier their spending earns now
//     (or none).
//
// A stored tier that is no longer on the ladder counts as no tier.
func Evaluate(tiers []Tier, spend float64, state State, today Day, holdMonths int) Evaluation {
	earned := EarnedTier(tiers, spend)
	current := find(tiers, state.TierID)
	hold := func() *Day { d := today.AddMonths(holdMonths); return &d }
	if earned != nil && (current == nil || earned.MinSpend >= current.MinSpend) {
		out := Evaluation{Tier: earned, ValidUntil: hold()}
		if current == nil || current.ID != earned.ID {
			out.Change = &Change{Direction: "up", From: current, To: earned}
		}
		return out
	}
	if current == nil {
		return Evaluation{}
	}
	if state.ValidUntil != nil && today <= *state.ValidUntil {
		return Evaluation{Tier: current, ValidUntil: state.ValidUntil}
	}
	out := Evaluation{Tier: earned, Change: &Change{Direction: "down", From: current, To: earned}}
	if earned != nil {
		out.ValidUntil = hold()
	}
	return out
}

// Next is the tier above current and the spending still needed to reach it.
type Next struct {
	Tier        Tier    `json:"tier"`
	SpendNeeded float64 `json:"spend_needed_idr"`
}

// NextTier is nil at the top of the ladder.
func NextTier(tiers []Tier, current *Tier, spend float64) *Next {
	floor := -1.0
	if current != nil {
		floor = current.MinSpend
	}
	for _, t := range SortTiers(tiers) {
		if t.MinSpend > floor {
			return &Next{Tier: t, SpendNeeded: max(t.MinSpend-spend, 0)}
		}
	}
	return nil
}

// Keep is the spending that keeps the current tier past its hold.
type Keep struct {
	SpendNeeded float64 `json:"spend_needed_idr"`
	By          *Day    `json:"by"`
}

// KeepTier is nil when spending already keeps the tier.
func KeepTier(current *Tier, spend float64, validUntil *Day) *Keep {
	if current == nil || spend >= current.MinSpend {
		return nil
	}
	return &Keep{SpendNeeded: current.MinSpend - spend, By: validUntil}
}

// CleanPerks trims the free-text perks, collapses inner spaces and drops
// blanks and case-insensitive duplicates.
func CleanPerks(perks []string) []string {
	out := []string{}
	for _, p := range perks {
		v := strings.Join(strings.Fields(p), " ")
		if v == "" || slices.ContainsFunc(out, func(x string) bool { return strings.EqualFold(x, v) }) {
			continue
		}
		out = append(out, v)
	}
	return out
}
