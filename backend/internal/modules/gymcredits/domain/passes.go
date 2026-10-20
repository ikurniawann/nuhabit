package domain

import (
	"fmt"
	"math"
	"time"
)

// Pass statuses (gym.member_passes.status). An active pass whose starts_at
// is still ahead is queued behind another pass.
const (
	PassActive   = "active"
	PassFrozen   = "frozen"
	PassExpired  = "expired"
	PassRefunded = "refunded"
)

// PassState is the part of a member pass the lifecycle rules read. FrozenAt
// and FrozenUntil are set while Status is frozen.
type PassState struct {
	Status      string
	StartsAt    time.Time
	EndsAt      time.Time
	FrozenAt    time.Time
	FrozenUntil time.Time
}

// ceilDays is d in whole days, rounded up; 0 when d <= 0.
func ceilDays(d time.Duration) int {
	if d <= 0 {
		return 0
	}
	return int(math.Ceil(d.Hours() / 24))
}

// StackedStart is when a newly paid pass starts: at payment, or when the
// member's last live pass ends if that is later, so no paid day overlaps.
func StackedStart(paidAt time.Time, lastEnd *time.Time) time.Time {
	if lastEnd != nil && lastEnd.After(paidAt) {
		return *lastEnd
	}
	return paidAt
}

// DaysLeft is what the pass still holds: the days to its end while running,
// its full length while queued, and the days left at the freeze while frozen.
func (p PassState) DaysLeft(now time.Time) int {
	switch {
	case p.Status == PassFrozen:
		return ceilDays(p.EndsAt.Sub(p.FrozenAt))
	case p.Status != PassActive:
		return 0
	case p.StartsAt.After(now):
		return ceilDays(p.EndsAt.Sub(p.StartsAt))
	}
	return ceilDays(p.EndsAt.Sub(now))
}

// FreezeAllowance is a member's freeze budget over the last 365 days.
type FreezeAllowance struct {
	MaxDaysPerYear int `json:"max_days_per_year"`
	MinDays        int `json:"min_days"`
	UsedDays       int `json:"used_days"`
	RemainingDays  int `json:"remaining_days"`
}

// NewFreezeAllowance applies the rules to the days already used.
func NewFreezeAllowance(r Rules, usedDays int) FreezeAllowance {
	return FreezeAllowance{
		MaxDaysPerYear: r.MaxFreezeDaysPerYear,
		MinDays:        r.MinFreezeDays,
		UsedDays:       usedDays,
		RemainingDays:  max(0, r.MaxFreezeDaysPerYear-usedDays),
	}
}

// CheckFreeze returns why the pass cannot be frozen for days from now, or "".
// Only a running pass freezes: not a queued, frozen or ended one.
func CheckFreeze(p PassState, now time.Time, days int, a FreezeAllowance) string {
	switch {
	case p.Status == PassFrozen:
		return "Pass sudah dibekukan"
	case p.Status != PassActive || !p.EndsAt.After(now):
		return "Hanya pass aktif yang bisa dibekukan"
	case p.StartsAt.After(now):
		return "Pass belum mulai berjalan"
	case a.MaxDaysPerYear == 0:
		return "Pembekuan pass tidak tersedia"
	case days < a.MinDays:
		return fmt.Sprintf("Pembekuan minimal %d hari", a.MinDays)
	case days > a.RemainingDays:
		return fmt.Sprintf("Sisa jatah pembekuan tahun ini %d hari", a.RemainingDays)
	}
	return ""
}

// UnfreezeDays is how far ends_at moves when a freeze ends at `at`: the
// frozen days, rounded up, never past frozen_until and at least one.
func UnfreezeDays(frozenAt, frozenUntil, at time.Time) int {
	if at.After(frozenUntil) {
		at = frozenUntil
	}
	return max(1, ceilDays(at.Sub(frozenAt)))
}

// ChargedFreezeDays is what a freeze of `days` costs from the yearly
// allowance: an early unfreeze still costs the minimum freeze.
func ChargedFreezeDays(days, minDays int) int { return max(days, minDays) }

// RenewalDue reports whether a pass ending at endsAt is inside the renewal
// window at now: leadDays before its end, and not yet ended.
func RenewalDue(endsAt, now time.Time, leadDays int) bool {
	return now.Before(endsAt) && !now.Before(endsAt.Add(-time.Duration(leadDays)*day))
}

// RefundQuote is the money back for a purchase: unused days of a pass, or
// unused credits of a credit pack.
type RefundQuote struct {
	TotalDays     int     `json:"total_days"`
	UnusedDays    int     `json:"unused_days"`
	UnusedCredits int     `json:"unused_credits"`
	ProratedIdr   float64 `json:"prorated_idr"`
}

// ProratedRefund pays back paidIdr * unused days / total days, rounded to
// the rupiah. A queued pass is fully unused; a frozen pass counts the days
// left when it was frozen; an ended pass is fully used.
func ProratedRefund(paidIdr float64, p PassState, now time.Time) RefundQuote {
	total := int(math.Round(p.EndsAt.Sub(p.StartsAt).Hours() / 24))
	unused := min(p.DaysLeft(now), total)
	q := RefundQuote{TotalDays: total, UnusedDays: unused}
	if total > 0 {
		q.ProratedIdr = math.Round(paidIdr * float64(unused) / float64(total))
	}
	return q
}
