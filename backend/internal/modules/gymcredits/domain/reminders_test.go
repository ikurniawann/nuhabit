package domain

import (
	"testing"
	"time"
)

func TestLowBalanceNudge(t *testing.T) {
	now := time.Date(2026, 10, 21, 10, 0, 0, 0, time.UTC)
	lot := func(id string, credits int, created, expires time.Duration) Lot {
		return Lot{ID: id, Credits: credits, CreatedAt: now.Add(created), ExpiresAt: now.Add(expires)}
	}
	topUp := func(l Lot) Entry {
		return Entry{ID: "e-" + l.ID, Type: TopUp, Amount: l.Credits, LotID: l.ID, CreatedAt: l.CreatedAt}
	}
	use := func(n int, at time.Duration) Entry {
		return Entry{ID: "use", Type: ClassDeduction, Amount: -n, CreatedAt: now.Add(at)}
	}
	old := lot("old", 10, -40*day, 20*day)
	fresh := lot("fresh", 10, -2*day, 50*day)

	t.Run("never had credits", func(t *testing.T) {
		if _, _, ok := LowBalanceNudge(nil, nil, now, 3); ok {
			t.Fatal("nudged a member without lots")
		}
	})
	t.Run("above threshold", func(t *testing.T) {
		if _, _, ok := LowBalanceNudge([]Lot{old}, []Entry{topUp(old), use(5, -time.Hour)}, now, 3); ok {
			t.Fatal("nudged at 5 credits with threshold 3")
		}
	})
	t.Run("at threshold after recent use", func(t *testing.T) {
		balance, period, ok := LowBalanceNudge([]Lot{old}, []Entry{topUp(old), use(7, -time.Hour)}, now, 3)
		if !ok || balance != 3 || period != "old" {
			t.Fatalf("balance=%d period=%q ok=%v", balance, period, ok)
		}
	})
	t.Run("dormant account", func(t *testing.T) {
		if _, _, ok := LowBalanceNudge([]Lot{old}, []Entry{topUp(old), use(9, -20*day)}, now, 3); ok {
			t.Fatal("nudged an account idle for 20 days")
		}
	})
	t.Run("a new top-up starts a new period", func(t *testing.T) {
		entries := []Entry{topUp(old), topUp(fresh), use(18, -time.Hour)}
		_, period, ok := LowBalanceNudge([]Lot{old, fresh}, entries, now, 3)
		if !ok || period != "fresh" {
			t.Fatalf("period=%q ok=%v, want the newest lot", period, ok)
		}
	})
	t.Run("lapsed credits do not count", func(t *testing.T) {
		lapsed := lot("lapsed", 10, -40*day, -time.Hour)
		balance, _, ok := LowBalanceNudge([]Lot{lapsed}, []Entry{topUp(lapsed), use(1, -2*day)}, now, 3)
		if !ok || balance != 0 {
			t.Fatalf("balance=%d ok=%v", balance, ok)
		}
	})
}

func TestExpiryPeriodAndDate(t *testing.T) {
	at := time.Date(2026, 10, 25, 20, 0, 0, 0, time.UTC) // Monday 03.00 WIB
	if got := ExpiryPeriod(at); got != "2026-10-25T20:00:00Z" {
		t.Fatalf("period = %q", got)
	}
	if got := FormatDateWib(at); got != "Senin, 26 Okt 2026" {
		t.Fatalf("date = %q", got)
	}
}
