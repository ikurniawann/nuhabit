package domain

import (
	"time"
)

// LowBalanceActiveDays limits low-balance nudges to members whose ledger
// moved this recently, so dormant accounts are not messaged.
const LowBalanceActiveDays = 14

// LowBalanceNudge decides whether a member gets a low-balance nudge. The
// period (the sent-log key) is the newest lot's id: one nudge per top-up.
// ok is false when the member never had credits, the spendable balance is
// above threshold, or nothing happened on the ledger within
// LowBalanceActiveDays.
func LowBalanceNudge(lots []Lot, entries []Entry, now time.Time, threshold int) (balance int, period string, ok bool) {
	var newest *Lot
	for i := range lots {
		if newest == nil || lots[i].CreatedAt.After(newest.CreatedAt) {
			newest = &lots[i]
		}
	}
	if newest == nil {
		return 0, "", false
	}
	active := false
	since := now.Add(-LowBalanceActiveDays * day)
	for _, e := range entries {
		if e.CreatedAt.After(since) {
			active = true
			break
		}
	}
	for _, r := range LotRemainders(lots, entries) {
		if r.Remaining > 0 && r.Lot.ExpiresAt.After(now) {
			balance += r.Remaining
		}
	}
	if !active || balance > threshold {
		return balance, "", false
	}
	return balance, newest.ID, true
}

// ExpiryPeriod keys an expiry reminder by the expiry instant.
func ExpiryPeriod(expiresAt time.Time) string {
	return expiresAt.UTC().Format(time.RFC3339)
}
