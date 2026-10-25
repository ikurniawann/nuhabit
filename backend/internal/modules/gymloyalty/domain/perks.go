package domain

// Perks are what the system applies for a member's tier: a POS discount,
// extra days on bookingOpensDaysBefore, a late-cancel window and a place
// ahead of lower tiers on the waitlist.
type Perks struct {
	DiscountPercent  float64 `json:"discount_percent"`
	EarlyBookingDays int     `json:"early_booking_days"`
	// CancelWindowHours is nil when the branch rule applies.
	CancelWindowHours *int `json:"cancel_window_hours"`
	// WaitlistRank orders the waitlist, highest first; 0 is plain FIFO.
	WaitlistRank int `json:"waitlist_rank"`
}

// TierPerks are the perks of a membership tier at rank on the ladder. A
// tier without waitlist priority keeps rank 0.
func TierPerks(t *Tier, rank int) Perks {
	if t == nil {
		return Perks{}
	}
	p := Perks{
		DiscountPercent:   min(max(t.DiscountPercent, 0), 100),
		EarlyBookingDays:  max(t.EarlyBookingDays, 0),
		CancelWindowHours: t.CancelWindowHours,
	}
	if t.WaitlistPriority {
		p.WaitlistRank = rank
	}
	return p
}

// Merge takes the better value of each perk: the higher discount, more
// early days, the shorter cancel window (a later free cancel) and the
// higher waitlist rank. The XP tiers and the membership tiers both feed it.
func (p Perks) Merge(o Perks) Perks {
	out := Perks{
		DiscountPercent:   max(p.DiscountPercent, o.DiscountPercent),
		EarlyBookingDays:  max(p.EarlyBookingDays, o.EarlyBookingDays),
		CancelWindowHours: p.CancelWindowHours,
		WaitlistRank:      max(p.WaitlistRank, o.WaitlistRank),
	}
	if o.CancelWindowHours != nil && (out.CancelWindowHours == nil || *o.CancelWindowHours < *out.CancelWindowHours) {
		out.CancelWindowHours = o.CancelWindowHours
	}
	return out
}
