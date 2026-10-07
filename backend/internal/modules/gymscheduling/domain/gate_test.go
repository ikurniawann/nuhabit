package domain

import (
	"reflect"
	"testing"
	"time"
)

func scan(mut func(*GateScanInput)) GateScanEvaluation {
	in := GateScanInput{
		MemberActive: true,
		Candidate:    &GateCandidate{BookingID: "bk1", CreditCost: 2},
		Balance:      3,
		Rules:        rules,
		Now:          now,
	}
	if mut != nil {
		mut(&in)
	}
	return EvaluateGateScan(in)
}

func minsAgo(m int) *time.Time { return ptr(now.Add(-time.Duration(m) * time.Minute)) }

func TestGateTokenProblemsHaveNoEffects(t *testing.T) {
	for problem, reason := range map[QrTokenProblem]GateDenialReason{
		QrNotFound: GateTokenInvalid, QrExpired: GateTokenExpired, QrConsumed: GateTokenConsumed,
	} {
		out := scan(func(in *GateScanInput) { in.TokenProblem = problem })
		if out.Decision != Denied || out.Reason != reason || len(out.Effects) != 0 {
			t.Errorf("%s: %+v", problem, out)
		}
	}
}

func TestGatePassSkipsCredits(t *testing.T) {
	out := scan(func(in *GateScanInput) { in.Balance, in.Candidate.HasPass = 0, true })
	want := []GateEffect{{Kind: EffectConsumeToken}, {Kind: EffectCheckIn, BookingID: "bk1"}}
	if out.Decision != Allowed || out.EntryKind != EntryBooking || !reflect.DeepEqual(out.Effects, want) {
		t.Errorf("pass: %+v", out)
	}
	if got := DescribeGateDecision(Allowed, "", EntryBooking, GateDetail{ClassName: "Engine", Pass: true}); got != "Check-in Engine · pass aktif, tanpa potong kredit" {
		t.Errorf("message: %q", got)
	}
}

func TestGateInactiveMemberConsumesToken(t *testing.T) {
	want := GateScanEvaluation{Decision: Denied, Reason: GateMemberNotActive, Effects: []GateEffect{{Kind: EffectConsumeToken}}}
	if got := scan(func(in *GateScanInput) { in.MemberActive = false }); !reflect.DeepEqual(got, want) {
		t.Errorf("got %+v", got)
	}
}

func TestGateReEntryAndAntiPassback(t *testing.T) {
	out := scan(func(in *GateScanInput) { in.LastAllowedEntryAt, in.Candidate = minsAgo(10), nil })
	if out.Decision != Allowed || out.EntryKind != EntryReEntry || !reflect.DeepEqual(out.Effects, []GateEffect{{Kind: EffectConsumeToken}}) {
		t.Errorf("re-entry: %+v", out)
	}
	if out := scan(func(in *GateScanInput) { in.LastAllowedEntryAt, in.Candidate = minsAgo(30), nil }); out.Reason != GateAntiPassback {
		t.Errorf("anti-passback: %+v", out)
	}
}

// A pending booking wins over re-entry and anti-passback, so back-to-back
// classes are still checked in.
func TestGatePendingBookingWinsOverAntiPassback(t *testing.T) {
	for _, m := range []int{10, 30} {
		out := scan(func(in *GateScanInput) { in.LastAllowedEntryAt = minsAgo(m) })
		if out.Decision != Allowed || out.EntryKind != EntryBooking {
			t.Errorf("%d mins ago: %+v", m, out)
		}
		if !containsEffect(out.Effects, GateEffect{Kind: EffectCheckIn, BookingID: "bk1"}) {
			t.Errorf("%d mins ago: missing check-in effect", m)
		}
	}
	if out := scan(func(in *GateScanInput) { in.LastAllowedEntryAt = minsAgo(61) }); out.EntryKind != EntryBooking {
		t.Errorf("past anti-passback: %+v", out)
	}
}

func containsEffect(effects []GateEffect, e GateEffect) bool {
	for _, x := range effects {
		if x == e {
			return true
		}
	}
	return false
}

func TestGateBookingAndCredits(t *testing.T) {
	if out := scan(func(in *GateScanInput) { in.Candidate = nil }); out.Decision != Denied || out.Reason != GateNoBooking {
		t.Errorf("no booking: %+v", out)
	}
	if out := scan(func(in *GateScanInput) { in.Balance = 1 }); out.Reason != GateInsufficientCredits {
		t.Errorf("low balance: %+v", out)
	}
	want := GateScanEvaluation{
		Decision:  Allowed,
		EntryKind: EntryBooking,
		Effects: []GateEffect{
			{Kind: EffectConsumeToken},
			{Kind: EffectDeductCredits, Amount: 2},
			{Kind: EffectCheckIn, BookingID: "bk1"},
		},
	}
	if got := scan(nil); !reflect.DeepEqual(got, want) {
		t.Errorf("allowed: %+v", got)
	}
}

func TestDescribeGateDecision(t *testing.T) {
	if got := DescribeGateDecision(Denied, GateNoBooking, "", GateDetail{}); got != "Tidak ada booking kelas" {
		t.Errorf("denied: %q", got)
	}
	if got := DescribeGateDecision(Allowed, "", EntryReEntry, GateDetail{}); got != "Masuk ulang dalam masa tenggang, tanpa potong kredit" {
		t.Errorf("re-entry: %q", got)
	}
	got := DescribeGateDecision(Allowed, "", EntryBooking, GateDetail{ClassName: "Engine Builder", Credits: 1, BalanceAfter: ptr(4)})
	if got != "Check-in Engine Builder · 1 kredit dipotong · sisa 4 kredit" {
		t.Errorf("booking: %q", got)
	}
}

func TestCheckQrToken(t *testing.T) {
	if CheckQrToken(nil, now) != QrNotFound {
		t.Error("missing")
	}
	if CheckQrToken(&QrToken{ExpiresAt: now.Add(time.Minute), ConsumedAt: ptr(now)}, now) != QrConsumed {
		t.Error("consumed wins over expiry")
	}
	if CheckQrToken(&QrToken{ExpiresAt: now.Add(-time.Second)}, now) != QrExpired {
		t.Error("expired")
	}
	if CheckQrToken(&QrToken{ExpiresAt: now}, now) != "" {
		t.Error("expiring exactly now is still valid")
	}
}
