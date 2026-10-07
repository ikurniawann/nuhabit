package domain

import (
	"testing"
	"time"
)

var rules = Rules{
	CancellationDeadlineHours: 4,
	LateCancelPolicy:          PolicyForfeit,
	NoShowPolicy:              PolicyForfeit,
	ReEntryGraceMin:           15,
	AntiPassbackMin:           60,
	WaitlistAutoPromote:       true,
	BookingOpensDaysBefore:    7,
	BookingClosesMinBefore:    0,
}

func at(s string) time.Time {
	t, err := time.Parse(time.RFC3339Nano, s)
	if err != nil {
		panic(err)
	}
	return t
}

var (
	start = at("2026-10-05T11:00:00Z") // Monday 18.00 WIB
	now   = at("2026-10-04T10:00:00Z")
)

func TestSessionAndBookingStateMachines(t *testing.T) {
	sessionCases := []struct {
		from, to SessionStatus
		want     bool
	}{
		{SessionDraft, SessionPublished, true},
		{SessionPublished, SessionFull, true},
		{SessionFull, SessionPublished, true},
		{SessionDraft, SessionCompleted, false},
		{SessionCompleted, SessionPublished, false},
		{SessionCancelled, SessionPublished, false},
	}
	for _, c := range sessionCases {
		if got := CanTransitionSession(c.from, c.to); got != c.want {
			t.Errorf("session %s -> %s = %v, want %v", c.from, c.to, got, c.want)
		}
	}
	bookingCases := []struct {
		from, to BookingStatus
		want     bool
	}{
		{BookingConfirmed, BookingCheckedIn, true},
		{BookingConfirmed, BookingNoShow, true},
		{BookingWaitlist, BookingConfirmed, true},
		{BookingWaitlist, BookingCheckedIn, false},
		{BookingCheckedIn, BookingCancelled, false},
		{BookingNoShow, BookingCheckedIn, false},
	}
	for _, c := range bookingCases {
		if got := CanTransitionBooking(c.from, c.to); got != c.want {
			t.Errorf("booking %s -> %s = %v, want %v", c.from, c.to, got, c.want)
		}
	}
}

func TestSessionStatusForSeats(t *testing.T) {
	cases := []struct {
		status          SessionStatus
		count, capacity int
		want            SessionStatus
	}{
		{SessionPublished, 2, 2, SessionFull},
		{SessionFull, 1, 2, SessionPublished},
		{SessionPublished, 1, 2, SessionPublished},
		{SessionDraft, 5, 2, SessionDraft},
		{SessionCompleted, 0, 2, SessionCompleted},
	}
	for _, c := range cases {
		if got := SessionStatusForSeats(c.status, c.count, c.capacity); got != c.want {
			t.Errorf("%s %d/%d = %s, want %s", c.status, c.count, c.capacity, got, c.want)
		}
	}
}

func TestDeriveBookingWindow(t *testing.T) {
	opens, closes := DeriveBookingWindow(start, Rules{BookingOpensDaysBefore: 7, BookingClosesMinBefore: 30})
	if !opens.Equal(at("2026-09-28T11:00:00Z")) || !closes.Equal(at("2026-10-05T10:30:00Z")) {
		t.Fatalf("window = %s .. %s", opens, closes)
	}
}

func session(mut func(*BookableSession)) BookableSession {
	s := BookableSession{
		Status:          SessionPublished,
		Capacity:        2,
		CreditCost:      2,
		BookingOpensAt:  at("2026-09-28T11:00:00Z"),
		BookingClosesAt: start,
	}
	if mut != nil {
		mut(&s)
	}
	return s
}

func eligibility(mut func(*EligibilityInput)) BookingDecision {
	in := EligibilityInput{MemberActive: true, Session: session(nil), Balance: 5, Now: now}
	if mut != nil {
		mut(&in)
	}
	return EvaluateBookingEligibility(in)
}

func deny(r BookingDenialReason) BookingDecision {
	return BookingDecision{Kind: DecisionDeny, Reason: r}
}

func TestEligibilityOrder(t *testing.T) {
	cases := []struct {
		name string
		mut  func(*EligibilityInput)
		want BookingDecision
	}{
		{"inactive member first", func(in *EligibilityInput) {
			in.MemberActive, in.Balance, in.HasActiveBooking = false, 0, true
		}, deny(DenyMemberNotActive)},
		{"draft", func(in *EligibilityInput) { in.Session.Status = SessionDraft }, deny(DenySessionNotBookable)},
		{"completed", func(in *EligibilityInput) { in.Session.Status = SessionCompleted }, deny(DenySessionNotBookable)},
		{"cancelled", func(in *EligibilityInput) { in.Session.Status = SessionCancelled }, deny(DenySessionNotBookable)},
		{"full goes to waitlist", func(in *EligibilityInput) { in.Session.Status, in.ConfirmedCount = SessionFull, 2 },
			BookingDecision{Kind: DecisionWaitlist, Position: 1}},
		{"not open yet", func(in *EligibilityInput) { in.Now = at("2026-09-27T00:00:00Z") }, deny(DenyBookingNotOpenYet)},
		{"closed", func(in *EligibilityInput) { in.Now = at("2026-10-05T11:00:01Z") }, deny(DenyBookingWindowClosed)},
		{"double booking before balance", func(in *EligibilityInput) { in.HasActiveBooking, in.Balance = true, 0 },
			deny(DenyAlreadyBooked)},
		{"low balance", func(in *EligibilityInput) { in.Balance = 1 }, deny(DenyInsufficientCredits)},
		{"low balance on waitlist too", func(in *EligibilityInput) { in.Balance, in.ConfirmedCount = 1, 2 },
			deny(DenyInsufficientCredits)},
		{"seat left", func(in *EligibilityInput) { in.Balance, in.ConfirmedCount = 2, 1 }, BookingDecision{Kind: DecisionConfirm}},
		{"next waitlist position", func(in *EligibilityInput) { in.ConfirmedCount, in.LastWaitlistPosition = 2, 3 },
			BookingDecision{Kind: DecisionWaitlist, Position: 4}},
	}
	for _, c := range cases {
		if got := eligibility(c.mut); got != c.want {
			t.Errorf("%s: got %+v, want %+v", c.name, got, c.want)
		}
	}
}

func TestCancellationAndNoShow(t *testing.T) {
	out := EvaluateCancellation(BookingConfirmed, start, 2, false, rules, at("2026-10-05T06:59:00Z"))
	if out.Late || out.PenaltyCredits != 0 || !out.Deadline.Equal(at("2026-10-05T07:00:00Z")) {
		t.Errorf("before deadline: %+v", out)
	}
	if out := EvaluateCancellation(BookingConfirmed, start, 2, false, rules, at("2026-10-05T07:00:01Z")); !out.Late || out.PenaltyCredits != 2 || out.PassStrike {
		t.Errorf("late forfeit: %+v", out)
	}
	if out := EvaluateCancellation(BookingConfirmed, start, 2, true, rules, at("2026-10-05T07:00:01Z")); !out.Late || out.PenaltyCredits != 0 || !out.PassStrike {
		t.Errorf("late with pass: %+v", out)
	}
	free := rules
	free.LateCancelPolicy = PolicyFree
	if out := EvaluateCancellation(BookingConfirmed, start, 2, false, free, at("2026-10-05T10:00:00Z")); !out.Late || out.PenaltyCredits != 0 {
		t.Errorf("late free: %+v", out)
	}
	if out := EvaluateCancellation(BookingConfirmed, start, 2, true, free, at("2026-10-05T10:00:00Z")); out.PassStrike {
		t.Errorf("late free with pass: %+v", out)
	}
	if out := EvaluateCancellation(BookingWaitlist, start, 2, false, rules, at("2026-10-05T10:59:00Z")); out.Late || out.PenaltyCredits != 0 {
		t.Errorf("waitlist: %+v", out)
	}
	if p, s := NoShowPenalty(2, false, rules); p != 2 || s {
		t.Error("no-show forfeit")
	}
	if p, s := NoShowPenalty(2, true, rules); p != 0 || !s {
		t.Error("no-show with pass")
	}
	if p, s := NoShowPenalty(2, true, Rules{NoShowPolicy: PolicyFree}); p != 0 || s {
		t.Error("no-show free")
	}
	if got := eligibility(func(in *EligibilityInput) { in.Balance, in.HasPass = 0, true }); got.Kind != DecisionConfirm {
		t.Errorf("pass without credits: %+v", got)
	}
	for from, want := range map[BookingStatus]BookingStatus{
		BookingCheckedIn: BookingCompleted, BookingConfirmed: BookingNoShow,
		BookingWaitlist: BookingCancelled, BookingCancelled: BookingCancelled,
	} {
		if got := BookingStatusOnComplete(from); got != want {
			t.Errorf("on complete %s = %s, want %s", from, got, want)
		}
	}
}

func ptr[T any](v T) *T { return &v }

func TestWaitlistFIFO(t *testing.T) {
	rows := []WaitlistEntry{
		{ID: "c", Status: BookingWaitlist, WaitlistPosition: ptr(2), CreatedAt: at("2026-10-01T00:00:00Z")},
		{ID: "x", Status: BookingConfirmed, CreatedAt: at("2026-09-01T00:00:00Z")},
		{ID: "b", Status: BookingWaitlist, WaitlistPosition: ptr(1), CreatedAt: at("2026-10-02T00:00:00Z")},
		{ID: "a", Status: BookingWaitlist, WaitlistPosition: ptr(1), CreatedAt: at("2026-10-01T12:00:00Z")},
	}
	if got := PickWaitlistPromotion(rows); got == nil || got.ID != "a" {
		t.Fatalf("lowest position, then earliest: %+v", got)
	}
	offered := append([]WaitlistEntry(nil), rows...)
	offered[3].PromotionOfferedAt = ptr(at("2026-10-03T00:00:00Z"))
	if got := PickWaitlistPromotion(offered); got == nil || got.ID != "b" {
		t.Fatalf("offered entries are skipped: %+v", got)
	}
	if PickWaitlistPromotion(rows[1:2]) != nil {
		t.Error("empty queue gives nil")
	}
	if NextWaitlistPosition(rows) != 3 || NextWaitlistPosition(nil) != 1 {
		t.Error("next position = max + 1")
	}
	if b, mode := PlanWaitlistPromotion(rows, true); b == nil || b.ID != "a" || mode != PromoteAuto {
		t.Errorf("auto: %+v %s", b, mode)
	}
	if _, mode := PlanWaitlistPromotion(rows, false); mode != PromoteOffer {
		t.Errorf("offer: %s", mode)
	}
	if b, _ := PlanWaitlistPromotion(nil, true); b != nil {
		t.Error("empty plan")
	}
}

func TestCheckInWindowAndWeeks(t *testing.T) {
	end := at("2026-10-05T12:00:00Z")
	for s, want := range map[string]bool{
		"2026-10-05T10:15:00Z": true, "2026-10-05T10:14:59Z": false,
		"2026-10-05T12:15:00Z": true, "2026-10-05T12:15:01Z": false,
	} {
		if got := IsWithinCheckInWindow(start, end, at(s)); got != want {
			t.Errorf("window at %s = %v", s, got)
		}
	}
	for s, want := range map[string]string{
		"2026-10-03T05:00:00Z": "2026-09-28", // Saturday
		"2026-10-04T18:00:00Z": "2026-10-05", // Monday 01.00 WIB
		"2026-10-04T16:59:00Z": "2026-09-28", // Sunday 23.59 WIB
	} {
		if got := WeekStartWib(at(s)); got != want {
			t.Errorf("week of %s = %s, want %s", s, got, want)
		}
	}
	if !ShiftDays(start, 7).Equal(at("2026-10-12T11:00:00Z")) {
		t.Error("shift days")
	}
}

func TestFormatWib(t *testing.T) {
	for s, want := range map[string]string{
		"2026-10-05T11:00:00Z": "Sen, 5 Okt, 18.00",
		"2026-01-04T01:05:00Z": "Min, 4 Jan, 08.05",
		"2026-05-06T17:30:00Z": "Kam, 7 Mei, 00.30",
		"2026-08-07T00:00:00Z": "Jum, 7 Agu, 07.00",
		"2026-12-12T03:00:00Z": "Sab, 12 Des, 10.00",
	} {
		if got := FormatWib(at(s)); got != want {
			t.Errorf("FormatWib(%s) = %q, want %q", s, got, want)
		}
	}
}

func TestIsClassTypeCovered(t *testing.T) {
	if !IsClassTypeCovered(nil, "t1") || IsClassTypeCovered([]string{"t2"}, "t1") || !IsClassTypeCovered([]string{"t1"}, "t1") {
		t.Error("coverage")
	}
}
