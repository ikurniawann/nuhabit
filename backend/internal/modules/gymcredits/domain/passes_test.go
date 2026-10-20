package domain

import (
	"testing"
	"time"
)

var t0 = time.Date(2026, 10, 1, 9, 0, 0, 0, time.UTC)

func days(n float64) time.Duration { return time.Duration(n * float64(day)) }

func running(start, end time.Duration) PassState {
	return PassState{Status: PassActive, StartsAt: t0.Add(start), EndsAt: t0.Add(end)}
}

func TestStackedStart(t *testing.T) {
	end := t0.Add(days(10))
	eq(t, StackedStart(t0, nil), t0)
	eq(t, StackedStart(t0, &end), end)
	past := t0.Add(-days(1))
	eq(t, StackedStart(t0, &past), t0)
}

func TestDaysLeft(t *testing.T) {
	p := running(-days(2), days(26))
	eq(t, p.DaysLeft(t0), 26)
	eq(t, p.DaysLeft(t0.Add(time.Hour)), 26) // a started day still counts
	eq(t, p.DaysLeft(t0.Add(days(30))), 0)

	queued := running(days(26), days(54))
	eq(t, queued.DaysLeft(t0), 28)

	frozen := PassState{Status: PassFrozen, StartsAt: t0.Add(-days(10)), EndsAt: t0.Add(days(18)), FrozenAt: t0.Add(-days(3)), FrozenUntil: t0.Add(days(4))}
	eq(t, frozen.DaysLeft(t0), 21)
	eq(t, frozen.DaysLeft(t0.Add(days(3))), 21) // paused

	eq(t, PassState{Status: PassRefunded, StartsAt: t0, EndsAt: t0.Add(days(5))}.DaysLeft(t0), 0)
}

func TestCheckFreeze(t *testing.T) {
	a := NewFreezeAllowance(Rules{MaxFreezeDaysPerYear: 30, MinFreezeDays: 7}, 20)
	eq(t, a, FreezeAllowance{MaxDaysPerYear: 30, MinDays: 7, UsedDays: 20, RemainingDays: 10})
	eq(t, NewFreezeAllowance(Rules{MaxFreezeDaysPerYear: 10, MinFreezeDays: 7}, 14).RemainingDays, 0)

	p := running(-days(1), days(27))
	eq(t, CheckFreeze(p, t0, 7, a).Message, "")
	eq(t, CheckFreeze(p, t0, 10, a).Message, "")
	eq(t, CheckFreeze(p, t0, 6, a).Message, "Pembekuan minimal 7 hari")
	eq(t, CheckFreeze(p, t0, 11, a).Message, "Sisa jatah pembekuan tahun ini 10 hari")
	eq(t, CheckFreeze(p, t0, 7, NewFreezeAllowance(Rules{MinFreezeDays: 7}, 0)).Message, "Pembekuan pass tidak tersedia")
	eq(t, CheckFreeze(running(days(27), days(55)), t0, 7, a).Message, "Pass belum mulai berjalan")
	eq(t, CheckFreeze(running(-days(28), -days(1)), t0, 7, a).Message, "Hanya pass aktif yang bisa dibekukan")
	p.Status = PassFrozen
	eq(t, CheckFreeze(p, t0, 7, a).Message, "Pass sudah dibekukan")
	p.Status = PassRefunded
	eq(t, CheckFreeze(p, t0, 7, a).Message, "Hanya pass aktif yang bisa dibekukan")
}

func TestUnfreezeDays(t *testing.T) {
	until := t0.Add(days(7))
	eq(t, UnfreezeDays(t0, until, until), 7)
	eq(t, UnfreezeDays(t0, until, until.Add(days(2))), 7) // the sweep ran late
	eq(t, UnfreezeDays(t0, until, t0.Add(days(2.5))), 3)
	eq(t, UnfreezeDays(t0, until, t0.Add(time.Minute)), 1)
	eq(t, ChargedFreezeDays(1, 7), 7)
	eq(t, ChargedFreezeDays(9, 7), 9)
}

func TestRenewalDue(t *testing.T) {
	end := t0.Add(days(3))
	eq(t, RenewalDue(end, t0, 3), true)
	eq(t, RenewalDue(end, t0.Add(-time.Minute), 3), false)
	eq(t, RenewalDue(end, end.Add(-time.Minute), 0), false)
	eq(t, RenewalDue(end, end, 3), false)
}

func TestProratedRefund(t *testing.T) {
	// 28-day pass, 7 days used: 21/28 of the price.
	eq(t, ProratedRefund(1_200_000, running(-days(7), days(21)), t0), RefundQuote{TotalDays: 28, UnusedDays: 21, ProratedIdr: 900_000})
	// Part of a day used counts as unused.
	eq(t, ProratedRefund(1_200_000, running(-days(6.5), days(21.5)), t0).UnusedDays, 22)
	// Queued: everything back.
	eq(t, ProratedRefund(1_000_000, running(days(5), days(33)), t0), RefundQuote{TotalDays: 28, UnusedDays: 28, ProratedIdr: 1_000_000})
	// Rounded to the rupiah.
	eq(t, ProratedRefund(100_000, running(-days(1), days(2)), t0).ProratedIdr, 66_667.0)
	// Frozen: the days left when it was frozen.
	frozen := PassState{Status: PassFrozen, StartsAt: t0.Add(-days(14)), EndsAt: t0.Add(days(14)), FrozenAt: t0.Add(-days(4)), FrozenUntil: t0.Add(days(3))}
	eq(t, ProratedRefund(2_800_000, frozen, t0), RefundQuote{TotalDays: 28, UnusedDays: 18, ProratedIdr: 1_800_000})
	// Ended.
	eq(t, ProratedRefund(1_000_000, running(-days(28), 0), t0), RefundQuote{TotalDays: 28})
}
