package domain

import "time"

// MemberPerks are what a member's tier and status change in booking
// (gym-loyalty decides them; the zero value changes nothing).
type MemberPerks struct {
	// EarlyBookingDays opens booking this many days before the session's
	// own opening.
	EarlyBookingDays int
	// CancelWindowHours is the tier's late-cancel window; nil keeps the
	// branch rule, and a window longer than the branch rule is ignored.
	CancelWindowHours *int
	// WaitlistRank puts the member ahead of lower ranks on the waitlist.
	WaitlistRank int
	// Banned members may not book or pass the gate.
	Banned bool
}

// BookingOpensAt is when booking opens for the member.
func (p MemberPerks) BookingOpensAt(opensAt time.Time) time.Time {
	return opensAt.Add(-time.Duration(max(p.EarlyBookingDays, 0)) * 24 * time.Hour)
}

// CancelRules are rules with the member's late-cancel window: the tier
// window when it is shorter than the branch rule.
func (p MemberPerks) CancelRules(rules Rules) Rules {
	if p.CancelWindowHours != nil && *p.CancelWindowHours < rules.CancellationDeadlineHours {
		rules.CancellationDeadlineHours = max(*p.CancelWindowHours, 0)
	}
	return rules
}
