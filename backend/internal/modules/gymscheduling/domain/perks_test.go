package domain

import (
	"reflect"
	"testing"
	"time"
)

func TestMemberPerksWindows(t *testing.T) {
	opens := start.Add(-7 * 24 * time.Hour)
	if got := (MemberPerks{EarlyBookingDays: 2}).BookingOpensAt(opens); !got.Equal(start.Add(-9 * 24 * time.Hour)) {
		t.Fatalf("early booking opens at %s", got)
	}
	if got := (MemberPerks{}).BookingOpensAt(opens); !got.Equal(opens) {
		t.Fatal("no perk keeps the opening")
	}
	// The tier window applies only when it is shorter than the branch rule (4h).
	for _, c := range []struct {
		window *int
		want   int
	}{{nil, 4}, {ptr(2), 2}, {ptr(6), 4}, {ptr(0), 0}} {
		if got := (MemberPerks{CancelWindowHours: c.window}).CancelRules(rules).CancellationDeadlineHours; got != c.want {
			t.Errorf("window %v: %d, want %d", c.window, got, c.want)
		}
	}
	// 3h before class is late under the branch rule, free with a 2h tier window.
	at3h := start.Add(-3 * time.Hour)
	if !EvaluateCancellation(BookingConfirmed, start, 2, false, rules, at3h).Late {
		t.Fatal("branch rule: late")
	}
	tier := MemberPerks{CancelWindowHours: ptr(2)}.CancelRules(rules)
	if out := EvaluateCancellation(BookingConfirmed, start, 2, false, tier, at3h); out.Late || out.PenaltyCredits != 0 {
		t.Fatalf("tier window: %+v", out)
	}
}

func TestEarlyBookingOpensTheWindow(t *testing.T) {
	early := at("2026-09-27T12:00:00Z") // eight days before the class, the branch opens at seven
	if got := eligibility(func(in *EligibilityInput) { in.Now = early }); got != deny(DenyBookingNotOpenYet) {
		t.Fatalf("without the perk: %+v", got)
	}
	got := eligibility(func(in *EligibilityInput) {
		in.Now = early
		in.Session.BookingOpensAt = MemberPerks{EarlyBookingDays: 2}.BookingOpensAt(in.Session.BookingOpensAt)
	})
	if got != (BookingDecision{Kind: DecisionConfirm}) {
		t.Fatalf("with two early days: %+v", got)
	}
}

func TestBannedMember(t *testing.T) {
	if got := eligibility(func(in *EligibilityInput) { in.Banned = true }); got != deny(DenyMemberBanned) {
		t.Fatalf("booking: %+v", got)
	}
	// A banned member on the waitlist is skipped at promotion.
	in := EligibilityInput{MemberActive: true, Banned: true, Session: session(nil), Balance: 5, Now: now}
	if got := EvaluateMemberEligibility(in); got != DenyMemberBanned {
		t.Fatalf("promotion: %s", got)
	}
	want := GateScanEvaluation{Decision: Denied, Reason: GateMemberBanned, Effects: []GateEffect{{Kind: EffectConsumeToken}}}
	if got := scan(func(in *GateScanInput) { in.MemberBanned = true }); !reflect.DeepEqual(got, want) {
		t.Fatalf("gate: %+v", got)
	}
}

func TestWaitlistTierRankFirst(t *testing.T) {
	rows := []WaitlistEntry{
		{ID: "a", Status: BookingWaitlist, WaitlistPosition: ptr(1), CreatedAt: at("2026-10-01T00:00:00Z")},
		{ID: "b", Status: BookingWaitlist, WaitlistPosition: ptr(2), CreatedAt: at("2026-10-01T01:00:00Z"), Rank: 2},
		{ID: "c", Status: BookingWaitlist, WaitlistPosition: ptr(3), CreatedAt: at("2026-10-01T02:00:00Z"), Rank: 3},
		{ID: "d", Status: BookingWaitlist, WaitlistPosition: ptr(4), CreatedAt: at("2026-10-01T03:00:00Z"), Rank: 2},
	}
	got := ""
	for _, e := range WaitlistQueue(rows) {
		got += e.ID
	}
	if got != "cbda" {
		t.Fatalf("rank first, then FIFO: %s", got)
	}
}
