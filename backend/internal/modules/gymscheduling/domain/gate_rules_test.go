package domain

import (
	"reflect"
	"testing"
	"time"

	"nuhabit/backend/internal/platform/localtime"
)

func TestWaiverMissing(t *testing.T) {
	required := Rules{RequireWaiver: true}
	v1, v0 := "1.0", "0.9"
	cases := []struct {
		name     string
		rules    Rules
		version  *string
		at       *time.Time
		current  string
		expected bool
	}{
		{"not required", Rules{}, nil, nil, "1.0", false},
		{"never accepted", required, nil, nil, "1.0", true},
		{"current version", required, &v1, ptr(now), "1.0", false},
		{"outdated version", required, &v0, ptr(now), "1.0", true},
		{"no version known", required, &v0, ptr(now), "", false},
		{"version without timestamp", required, &v1, nil, "1.0", true},
	}
	for _, c := range cases {
		if got := WaiverMissing(c.rules, c.version, c.at, c.current); got != c.expected {
			t.Errorf("%s: got %v", c.name, got)
		}
	}
}

func TestBookingDeniedWithoutWaiver(t *testing.T) {
	in := EligibilityInput{MemberActive: true, WaiverMissing: true, Balance: 5, Now: now,
		Session: BookableSession{Status: SessionPublished, Capacity: 10, CreditCost: 1, StartsAt: start,
			BookingOpensAt: now.Add(-time.Hour), BookingClosesAt: start}}
	if got := EvaluateBookingEligibility(in); got.Kind != DecisionDeny || got.Reason != DenyWaiverRequired {
		t.Errorf("booking: %+v", got)
	}
	// A pass does not waive the waiver.
	in.HasPass = true
	if got := EvaluateMemberEligibility(in); got != DenyWaiverRequired {
		t.Errorf("pass holder: %q", got)
	}
	in.WaiverMissing = false
	if got := EvaluateMemberEligibility(in); got != "" {
		t.Errorf("accepted: %q", got)
	}
}

func TestBookingDeniedWithoutParq(t *testing.T) {
	in := EligibilityInput{MemberActive: true, ParqMissing: true, HasPass: true, Now: now,
		Session: BookableSession{Status: SessionPublished, Capacity: 10, CreditCost: 1, StartsAt: start,
			BookingOpensAt: now.Add(-time.Hour), BookingClosesAt: start}}
	if got := EvaluateBookingEligibility(in); got.Kind != DecisionDeny || got.Reason != DenyParqRequired {
		t.Errorf("booking: %+v", got)
	}
	// The waiver comes first.
	in.WaiverMissing = true
	if got := EvaluateMemberEligibility(in); got != DenyWaiverRequired {
		t.Errorf("waiver first: %q", got)
	}
	in.WaiverMissing, in.ParqMissing = false, false
	if got := EvaluateMemberEligibility(in); got != "" {
		t.Errorf("declared: %q", got)
	}
}

func TestGateDeniesWithoutWaiver(t *testing.T) {
	want := GateScanEvaluation{Decision: Denied, Reason: GateWaiverRequired, Effects: []GateEffect{{Kind: EffectConsumeToken}}}
	if got := scan(func(in *GateScanInput) { in.WaiverMissing = true }); !reflect.DeepEqual(got, want) {
		t.Errorf("got %+v", got)
	}
	// An inactive membership is reported first.
	if got := scan(func(in *GateScanInput) { in.WaiverMissing, in.MemberActive = true, false }); got.Reason != GateMemberNotActive {
		t.Errorf("inactive: %+v", got)
	}
}

func TestIsOpenGymTime(t *testing.T) {
	// Monday 06.00 to 22.00 WIB only.
	hours := []OpenHours{{Weekday: 1, Opens: 6 * 60, Closes: 22 * 60}}
	for s, want := range map[string]bool{
		"2026-10-04T23:00:00Z": true,  // Monday 06.00 WIB
		"2026-10-04T22:59:00Z": false, // Monday 05.59 WIB
		"2026-10-05T14:59:00Z": true,  // Monday 21.59 WIB
		"2026-10-05T15:00:00Z": false, // Monday 22.00 WIB
		"2026-10-06T03:00:00Z": false, // Tuesday 10.00 WIB
	} {
		if got := IsOpenGymTime(hours, at(s), localtime.Jakarta); got != want {
			t.Errorf("%s: got %v", s, got)
		}
	}
	if !IsOpenGymTime(nil, now, localtime.Jakarta) {
		t.Error("no hours set means open all day")
	}
	// The same hours in a WITA branch: 06.00 WITA is 05.00 WIB.
	wita := localtime.Zone("Asia/Makassar")
	for s, want := range map[string]bool{
		"2026-10-04T22:00:00Z": true,  // Monday 06.00 WITA
		"2026-10-04T21:59:00Z": false, // Monday 05.59 WITA
		"2026-10-05T14:00:00Z": false, // Monday 22.00 WITA, 21.00 WIB
	} {
		if got := IsOpenGymTime(hours, at(s), wita); got != want {
			t.Errorf("WITA %s: got %v", s, got)
		}
	}
}

func TestGateOpenGym(t *testing.T) {
	cost := Rules{ReEntryGraceMin: 15, AntiPassbackMin: 60, OpenGymEnabled: true, OpenGymCreditCost: 2}
	openGym := func(v OpenGymVisit, balance int, mut ...func(*GateScanInput)) GateScanEvaluation {
		return scan(func(in *GateScanInput) {
			in.Candidate, in.OpenGym, in.Balance, in.Rules = nil, &v, balance, cost
			for _, m := range mut {
				m(in)
			}
		})
	}
	consume := GateEffect{Kind: EffectConsumeToken}

	charged := openGym(OpenGymVisit{Open: true}, 5)
	want := GateScanEvaluation{Decision: Allowed, EntryKind: EntryOpenGym,
		Effects: []GateEffect{consume, {Kind: EffectChargeOpenGym, Amount: 2}}}
	if !reflect.DeepEqual(charged, want) {
		t.Errorf("first visit: %+v", charged)
	}
	free := GateScanEvaluation{Decision: Allowed, EntryKind: EntryOpenGym, Effects: []GateEffect{consume}}
	for name, got := range map[string]GateScanEvaluation{
		"paid today": openGym(OpenGymVisit{Open: true, PaidToday: true}, 0),
		"pass":       openGym(OpenGymVisit{Open: true, HasPass: true}, 0),
		"free open gym": openGym(OpenGymVisit{Open: true}, 0, func(in *GateScanInput) {
			in.Rules.OpenGymCreditCost = 0
		}),
	} {
		if !reflect.DeepEqual(got, free) {
			t.Errorf("%s: %+v", name, got)
		}
	}
	if got := openGym(OpenGymVisit{Open: true}, 1); got.Reason != GateInsufficientCredits {
		t.Errorf("short balance: %+v", got)
	}
	if got := openGym(OpenGymVisit{Open: false, HasPass: true}, 5); got.Reason != GateOpenGymClosed {
		t.Errorf("closed: %+v", got)
	}
	// Anti-passback still applies to open gym.
	if got := openGym(OpenGymVisit{Open: true, PaidToday: true}, 5, func(in *GateScanInput) {
		in.LastAllowedEntryAt = minsAgo(30)
	}); got.Reason != GateAntiPassback {
		t.Errorf("anti-passback: %+v", got)
	}
	if got := DescribeGateDecision(Allowed, "", EntryOpenGym, GateDetail{Credits: 2, BalanceAfter: ptr(3)}); got != "Open gym · 2 kredit dipotong · sisa 3 kredit" {
		t.Errorf("message: %q", got)
	}
	if got := DescribeGateDecision(Allowed, "", EntryOpenGym, GateDetail{}); got != "Open gym · tanpa potong kredit" {
		t.Errorf("free message: %q", got)
	}
}

func TestDeviceDisplay(t *testing.T) {
	name := "  Budi Santoso"
	if got := DeviceDisplay(Allowed, "", &name); got != "Silakan masuk, Budi" {
		t.Errorf("allowed: %q", got)
	}
	if got := DeviceDisplay(Allowed, "", nil); got != "Silakan masuk" {
		t.Errorf("no name: %q", got)
	}
	if got := DeviceDisplay(Denied, GateWaiverRequired, &name); got != "Ditolak: "+GateDenialLabel[GateWaiverRequired] {
		t.Errorf("denied: %q", got)
	}
}

func TestCheckCorrection(t *testing.T) {
	week := Rules{CorrectionWindowDays: 7}
	ok := func(c Correction, status BookingStatus, session SessionStatus, at time.Time) string {
		return CheckCorrection(c, status, session, start, week, at)
	}
	if got := ok(UndoCheckIn, BookingCheckedIn, SessionPublished, start.Add(time.Hour)); got != "" {
		t.Errorf("check-in: %q", got)
	}
	if got := ok(UndoCheckIn, BookingCompleted, SessionCompleted, start.Add(6*24*time.Hour)); got != "" {
		t.Errorf("completed: %q", got)
	}
	if got := ok(UndoNoShow, BookingNoShow, SessionCompleted, start.Add(7*24*time.Hour)); got != "" {
		t.Errorf("last day: %q", got)
	}
	if got := ok(UndoNoShow, BookingNoShow, SessionCompleted, start.Add(7*24*time.Hour+time.Second)); got != "Koreksi hanya bisa dalam 7 hari setelah kelas" {
		t.Errorf("too late: %q", got)
	}
	if got := ok(UndoNoShow, BookingConfirmed, SessionPublished, start); got != "Hanya booking tidak hadir yang bisa dikoreksi" {
		t.Errorf("not a no-show: %q", got)
	}
	if got := ok(UndoCheckIn, BookingNoShow, SessionPublished, start); got == "" {
		t.Error("undo check-in on a no-show")
	}
	if got := ok(UndoCheckIn, BookingCheckedIn, SessionCancelled, start); got != "Sesi sudah dibatalkan dan kreditnya sudah dikembalikan" {
		t.Errorf("cancelled session: %q", got)
	}
	if got := CheckCorrection(UndoCheckIn, BookingCheckedIn, SessionPublished, start, Rules{}, start.Add(time.Minute)); got == "" {
		t.Error("a zero-day window allows nothing after the start")
	}
}

func TestChargeKeys(t *testing.T) {
	if got := ChargeKey("checkin", "b1", 0); got != "gym:checkin:b1" {
		t.Errorf("first: %q", got)
	}
	if got := ChargeKey("no_show", "b1", 2); got != "gym:no_show:b1:2" {
		t.Errorf("after corrections: %q", got)
	}
	if got := CorrectionRefundKey("gym:checkin:b1"); got != "gym:correction:gym:checkin:b1" {
		t.Errorf("refund: %q", got)
	}
}

func TestRequeueAfterLapse(t *testing.T) {
	if !RequeueAfterLapse(0) {
		t.Error("first lapse re-queues")
	}
	if RequeueAfterLapse(1) {
		t.Error("second lapse removes")
	}
}
