package domain

import (
	"testing"
	"time"
)

func scheme(over func(*IncentiveScheme)) IncentiveScheme {
	s := IncentiveScheme{ID: "default", IsDefault: true, SessionFeeIDR: 150_000, PerAttendeeIDR: 15_000,
		FullClassBonusIDR: 50_000, FullClassThresholdPercent: 80, IsActive: true}
	if over != nil {
		over(&s)
	}
	return s
}

func mustTime(s string) time.Time {
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		panic(err)
	}
	return t
}

func session(over func(*StatementSession)) StatementSession {
	s := StatementSession{ID: "s1", CoachID: ptr("coach-a"), ClassTypeID: "fundamentals", ClassTypeName: "HYROX Fundamentals",
		StartsAt: mustTime("2026-09-10T00:00:00Z"), Capacity: 10, Status: "completed"}
	if over != nil {
		over(&s)
	}
	return s
}

func repeat(v string, n int) []string {
	out := make([]string, n)
	for i := range out {
		out[i] = v
	}
	return out
}

func withStatuses(statuses ...string) func(*StatementSession) {
	return func(s *StatementSession) { s.BookingStatuses = statuses }
}

func TestResolveSchemeAndRateFor(t *testing.T) {
	coachScheme := scheme(func(s *IncentiveScheme) {
		s.ID, s.CoachID, s.IsDefault, s.SessionFeeIDR = "coach", ptr("coach-a"), false, 200_000
	})

	t.Run("prefers an active coach scheme over the default", func(t *testing.T) {
		eq(t, ResolveScheme(scheme(nil), &coachScheme).ID, "coach")
		inactive := coachScheme
		inactive.IsActive = false
		eq(t, ResolveScheme(scheme(nil), &inactive).ID, "default")
		eq(t, ResolveScheme(scheme(nil), nil).ID, "default")
	})

	t.Run("uses the class-type rate when one exists", func(t *testing.T) {
		s := scheme(func(s *IncentiveScheme) {
			s.Rates = []SchemeRate{{ClassTypeID: "race-sim", SessionFeeIDR: 300_000, PerAttendeeIDR: 25_000}}
		})
		eq(t, RateFor(s, "race-sim"), SchemeRate{ClassTypeID: "race-sim", SessionFeeIDR: 300_000, PerAttendeeIDR: 25_000})
		eq(t, RateFor(s, "mobility"), SchemeRate{ClassTypeID: "mobility", SessionFeeIDR: 150_000, PerAttendeeIDR: 15_000})
	})
}

func TestComputeLine(t *testing.T) {
	t.Run("pays fee plus attendees, counting checked_in and completed as attended", func(t *testing.T) {
		line := ComputeLine(scheme(nil), session(withStatuses("checked_in", "completed", "confirmed", "cancelled", "waitlist", "no_show")))
		eq(t, []any{line.Booked, line.Attended, line.NoShows, line.AttendeeIDR, line.BonusIDR, line.TotalIDR},
			[]any{4, 2, 1, 30_000.0, 0.0, 180_000.0})
	})

	t.Run("adds the full-class bonus at the threshold, not below", func(t *testing.T) {
		eq(t, ComputeLine(scheme(nil), session(withStatuses(repeat("checked_in", 8)...))).BonusIDR, 50_000.0)
		eq(t, ComputeLine(scheme(nil), session(withStatuses(repeat("checked_in", 7)...))).BonusIDR, 0.0)
	})

	t.Run("never pays a bonus for a zero-capacity class", func(t *testing.T) {
		line := ComputeLine(scheme(func(s *IncentiveScheme) { s.FullClassThresholdPercent = 0 }),
			session(func(s *StatementSession) { s.Capacity = 0 }))
		eq(t, line.BonusIDR, 0.0)
	})

	t.Run("deducts no-shows and clamps the line at zero", func(t *testing.T) {
		harsh := scheme(func(s *IncentiveScheme) { s.SessionFeeIDR, s.PerAttendeeIDR, s.NoShowPenaltyIDR = 50_000, 0, 30_000 })
		line := ComputeLine(harsh, session(withStatuses(repeat("no_show", 3)...)))
		eq(t, line.PenaltyIDR, 90_000.0)
		eq(t, line.TotalIDR, 0.0)
	})

	t.Run("applies class-type overrides to fee and per-attendee pay", func(t *testing.T) {
		s := scheme(func(s *IncentiveScheme) {
			s.Rates = []SchemeRate{{ClassTypeID: "fundamentals", SessionFeeIDR: 100_000, PerAttendeeIDR: 20_000}}
		})
		line := ComputeLine(s, session(withStatuses(repeat("checked_in", 3)...)))
		eq(t, []float64{line.SessionFeeIDR, line.AttendeeIDR, line.TotalIDR}, []float64{100_000, 60_000, 160_000})
	})
}

func TestComputeCoachStatement(t *testing.T) {
	at := func(id, startsAt string, over func(*StatementSession)) StatementSession {
		return session(func(s *StatementSession) {
			s.ID = id
			if startsAt != "" {
				s.StartsAt = mustTime(startsAt)
			}
			if over != nil {
				over(s)
			}
		})
	}
	sessions := []StatementSession{
		at("late", "2026-09-20T00:00:00Z", withStatuses(repeat("checked_in", 8)...)),
		at("early", "2026-09-02T00:00:00Z", withStatuses("checked_in", "no_show")),
		at("other-coach", "", func(s *StatementSession) { s.CoachID = ptr("coach-b") }),
		at("cancelled", "", func(s *StatementSession) { s.Status = "cancelled" }),
		at("published", "", func(s *StatementSession) { s.Status = "published" }),
		// 1 Oct 06:00 WIB = 30 Sep 23:00 UTC → October.
		at("october-wib", "2026-09-30T23:00:00Z", nil),
		// 1 Sep 00:30 WIB = 31 Aug 17:30 UTC → September.
		at("september-wib", "2026-08-31T17:30:00Z", nil),
	}
	statement, err := ComputeCoachStatement("coach-a", "2026-09", scheme(func(s *IncentiveScheme) { s.NoShowPenaltyIDR = 10_000 }), sessions)
	if err != nil {
		t.Fatal(err)
	}

	t.Run("keeps only the coach's completed classes inside the WIB month, oldest first", func(t *testing.T) {
		var got []string
		for _, l := range statement.Lines {
			got = append(got, l.SessionID)
		}
		eq(t, got, []string{"september-wib", "early", "late"})
	})

	t.Run("totals the lines", func(t *testing.T) {
		// september-wib: 150k; early: 150k + 15k − 10k = 155k; late: 150k + 120k + 50k = 320k.
		eq(t, statement.Totals, CoachStatementTotals{Sessions: 3, Attended: 9, NoShows: 1, SessionFeeIDR: 450_000,
			AttendeeIDR: 135_000, BonusIDR: 50_000, PenaltyIDR: 10_000, TotalIDR: 625_000})
		eq(t, []string{statement.CoachID, statement.PeriodMonth, statement.SchemeID}, []string{"coach-a", "2026-09", "default"})
	})

	t.Run("is empty for a coach with no classes", func(t *testing.T) {
		empty, _ := ComputeCoachStatement("nobody", "2026-09", scheme(nil), sessions)
		eq(t, empty.Lines, []CoachStatementLine{})
		eq(t, empty.Totals.TotalIDR, 0.0)
	})
}

func TestPeriods(t *testing.T) {
	t.Run("bounds a month in WIB", func(t *testing.T) {
		p, _ := MonthPeriod("2026-09")
		eq(t, []string{ISO(p.Start), ISO(p.End)}, []string{"2026-08-31T17:00:00.000Z", "2026-09-30T17:00:00.000Z"})
		dec, _ := MonthPeriod("2026-12")
		eq(t, ISO(dec.End), "2026-12-31T17:00:00.000Z")
	})
	t.Run("rejects malformed periods", func(t *testing.T) {
		eq(t, IsPeriodMonth("2026-13"), false)
		eq(t, IsPeriodMonth("2026-9"), false)
		if _, err := MonthPeriod("bad"); err == nil {
			t.Fatal("bad period should fail")
		}
	})
}

func TestDecidePayoutAction(t *testing.T) {
	decide := func(current, action string, ref, note *string) PayoutDecision {
		t.Helper()
		d, refusal := DecidePayoutAction(current, action, ref, note)
		if refusal != "" {
			t.Fatal(refusal)
		}
		return d
	}
	refusal := func(current, action string, ref, note *string) string {
		_, r := DecidePayoutAction(current, action, ref, note)
		return r
	}

	t.Run("walks draft → approved → paid", func(t *testing.T) {
		eq(t, decide("draft", "approve", nil, nil), PayoutDecision{Status: "approved"})
		eq(t, decide("approved", "pay", ptr(" TRF-0925 "), nil), PayoutDecision{Status: "paid", PaymentReference: ptr("TRF-0925")})
	})

	t.Run("requires a payment reference to pay and a note to void", func(t *testing.T) {
		eq(t, refusal("approved", "pay", ptr("  "), nil), "Referensi pembayaran wajib diisi.")
		eq(t, refusal("draft", "void", nil, nil), "Alasan pembatalan wajib diisi.")
		eq(t, decide("approved", "void", nil, ptr("Salah hitung")).Status, "void")
	})

	t.Run("refuses illegal moves", func(t *testing.T) {
		eq(t, refusal("draft", "pay", ptr("x"), nil), "Payout berstatus draf tidak bisa dibayar.")
		eq(t, refusal("paid", "void", nil, ptr("x")), "Payout berstatus dibayar tidak bisa dibatalkan.")
		eq(t, refusal("void", "approve", nil, nil), "Payout berstatus dibatalkan tidak bisa disetujui.")
	})
}
