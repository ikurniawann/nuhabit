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
		{"staff override after close", func(in *EligibilityInput) { in.Now, in.OverrideWindow = at("2026-10-05T11:00:01Z"), true },
			BookingDecision{Kind: DecisionConfirm}},
		{"staff override before open", func(in *EligibilityInput) { in.Now, in.OverrideWindow = at("2026-09-27T00:00:00Z"), true },
			BookingDecision{Kind: DecisionConfirm}},
		{"override keeps the credit check", func(in *EligibilityInput) {
			in.Now, in.OverrideWindow, in.Balance = at("2026-10-05T11:00:01Z"), true, 1
		}, deny(DenyInsufficientCredits)},
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
	ids := func(q []WaitlistEntry) string {
		s := ""
		for _, e := range q {
			s += e.ID
		}
		return s
	}
	if got := ids(WaitlistQueue(rows)); got != "abc" {
		t.Fatalf("lowest position, then earliest: %s", got)
	}
	offered := append([]WaitlistEntry(nil), rows...)
	offered[3].PromotionOfferedAt = ptr(at("2026-10-03T00:00:00Z"))
	if got := ids(WaitlistQueue(offered)); got != "bc" {
		t.Fatalf("offered entries are skipped: %s", got)
	}
	if len(WaitlistQueue(rows[1:2])) != 0 {
		t.Error("empty queue")
	}
	if NextWaitlistPosition(rows) != 3 || NextWaitlistPosition(nil) != 1 {
		t.Error("next position = max + 1")
	}
}

func TestWaitlistPromotionRules(t *testing.T) {
	r := rules
	r.WaitlistPromoteCutoffMin, r.WaitlistOfferMinutes = 60, 30
	cases := []struct {
		name string
		auto bool
		now  string
		want PromotionMode
	}{
		{"auto before the cutoff", true, "2026-10-05T09:59:59Z", PromoteAuto},
		{"offer at the cutoff", true, "2026-10-05T10:00:00Z", PromoteOffer},
		{"offer when auto is off", false, "2026-10-04T00:00:00Z", PromoteOffer},
	}
	for _, c := range cases {
		r.WaitlistAutoPromote = c.auto
		if got := WaitlistPromotionMode(r, start, at(c.now)); got != c.want {
			t.Errorf("%s: %s", c.name, got)
		}
	}
	if got := OfferExpiry(r, start, at("2026-10-05T10:00:00Z")); !got.Equal(at("2026-10-05T10:30:00Z")) {
		t.Errorf("expiry = %s", got)
	}
	if got := OfferExpiry(r, start, at("2026-10-05T10:45:00Z")); !got.Equal(start) {
		t.Errorf("expiry is capped at booking close: %s", got)
	}
	if FreeSeats(5, 3, 1) != 1 || FreeSeats(2, 2, 1) != 0 {
		t.Error("free seats")
	}
	lapse := at("2026-10-05T10:30:00Z")
	if !HoldsSeat(BookingConfirmed, nil, now) || !HoldsSeat(BookingWaitlist, &lapse, lapse.Add(-time.Second)) ||
		HoldsSeat(BookingWaitlist, &lapse, lapse) || HoldsSeat(BookingWaitlist, nil, now) || HoldsSeat(BookingCancelled, &lapse, now) {
		t.Error("holds seat")
	}
	open := session(func(s *BookableSession) { s.StartsAt = start })
	if !CanPromoteWaitlist(open, now) || CanPromoteWaitlist(open, start) ||
		CanPromoteWaitlist(session(func(s *BookableSession) { s.StartsAt, s.Status = start, SessionCompleted }), now) {
		t.Error("promotion only while booking is open")
	}
}

func TestOfferAcceptance(t *testing.T) {
	offeredAt, expires := at("2026-10-05T09:00:00Z"), at("2026-10-05T09:30:00Z")
	base := OfferInput{
		Status: BookingWaitlist, OfferedAt: &offeredAt, ExpiresAt: &expires,
		Session: session(func(s *BookableSession) { s.StartsAt = start }), SeatsTaken: 1, Now: at("2026-10-05T09:10:00Z"),
	}
	cases := []struct {
		name string
		mut  func(*OfferInput)
		want BookingDenialReason
	}{
		{"open offer", func(*OfferInput) {}, ""},
		{"no offer", func(in *OfferInput) { in.OfferedAt = nil }, DenyNoOffer},
		{"not on the waitlist", func(in *OfferInput) { in.Status = BookingConfirmed }, DenyNoOffer},
		{"expired", func(in *OfferInput) { in.Now = expires }, DenyOfferExpired},
		{"class started", func(in *OfferInput) { in.Now, in.ExpiresAt = start, nil }, DenyBookingWindowClosed},
		{"seat taken", func(in *OfferInput) { in.SeatsTaken = 2 }, DenySeatTaken},
	}
	for _, c := range cases {
		in := base
		c.mut(&in)
		if got := EvaluateOfferAcceptance(in); got != c.want {
			t.Errorf("%s: %q, want %q", c.name, got, c.want)
		}
	}
}

func TestMemberEligibility(t *testing.T) {
	until := at("2026-10-06T00:00:00Z")
	cases := []struct {
		name string
		mut  func(*EligibilityInput)
		want BookingDenialReason
	}{
		{"qualifies", nil, ""},
		{"reserved credits count", func(in *EligibilityInput) { in.Balance, in.Reserved = 5, 4 }, DenyInsufficientCredits},
		{"reserved but enough left", func(in *EligibilityInput) { in.Balance, in.Reserved = 5, 3 }, ""},
		{"pass ignores credits", func(in *EligibilityInput) { in.Balance, in.Reserved, in.HasPass = 0, 4, true }, ""},
		{"package does not cover", func(in *EligibilityInput) { in.ClassNotCovered = true }, DenyClassNotCovered},
		{"lot check fits despite reserved credits of other types", func(in *EligibilityInput) {
			in.Balance, in.Reserved, in.CreditsFit = 1, 8, new(true)
		}, ""},
		{"lot check short despite the balance", func(in *EligibilityInput) { in.CreditsFit = new(false) }, DenyInsufficientCredits},
		{"lot check leaves an uncovered class to coverage", func(in *EligibilityInput) {
			in.CreditsFit, in.ClassNotCovered = new(false), true
		}, DenyClassNotCovered},
		{"pass ignores coverage", func(in *EligibilityInput) { in.ClassNotCovered, in.HasPass = true, true }, ""},
		{"concurrent cap", func(in *EligibilityInput) { in.MaxConcurrent, in.UpcomingConfirmed = 2, 2 }, DenyConcurrentLimit},
		{"under concurrent cap", func(in *EligibilityInput) { in.MaxConcurrent, in.UpcomingConfirmed = 2, 1 }, ""},
		{"no concurrent cap", func(in *EligibilityInput) { in.UpcomingConfirmed = 50 }, ""},
		{"daily cap applies to pass holders", func(in *EligibilityInput) { in.HasPass, in.MaxPerDay, in.SameDayBookings = true, 1, 1 },
			DenyDailyLimit},
		{"suspended", func(in *EligibilityInput) { in.SuspendedUntil = &until }, DenyPassSuspended},
		{"suspension over", func(in *EligibilityInput) { in.SuspendedUntil, in.Now = &until, until }, ""},
		{"suspension before caps", func(in *EligibilityInput) {
			in.SuspendedUntil, in.MaxConcurrent, in.UpcomingConfirmed = &until, 1, 1
		}, DenyPassSuspended},
	}
	for _, c := range cases {
		in := EligibilityInput{MemberActive: true, Session: session(nil), Balance: 5, Now: now}
		if c.mut != nil {
			c.mut(&in)
		}
		if got := EvaluateMemberEligibility(in); got != c.want {
			t.Errorf("%s: %q, want %q", c.name, got, c.want)
		}
	}

	in := EligibilityInput{Session: session(nil), Balance: 3, Reserved: 2, MaxConcurrent: 4, MaxPerDay: 2, SuspendedUntil: &until}
	for r, want := range map[BookingDenialReason]string{
		DenyInsufficientCredits: "Kredit tidak cukup untuk kelas ini: tersedia 1, butuh 2 (2 kredit sudah terpakai untuk booking lain)",
		DenyConcurrentLimit:     "Batas booking aktif tercapai: maksimal 4 kelas mendatang",
		DenyDailyLimit:          "Batas booking tercapai: maksimal 2 kelas per hari",
		DenyPassSuspended:       "Booking ditangguhkan sampai Sel, 6 Okt, 07.00 karena batas strike pass tercapai (batal terlambat atau tidak hadir)",
		DenyAlreadyBooked:       "Anda sudah punya tempat di kelas ini",
	} {
		if got := in.DenialMessage(r); got != want {
			t.Errorf("message %s = %q", r, got)
		}
	}
	in.Reserved = 0
	if got := in.DenialMessage(DenyInsufficientCredits); got != "Kredit tidak cukup untuk kelas ini" {
		t.Errorf("plain credit message = %q", got)
	}
	in.Balance, in.CreditsFit = 5, new(false)
	if got := in.DenialMessage(DenyInsufficientCredits); got != "Kredit tidak cukup untuk kelas ini: kredit yang berlaku sudah dipesan untuk booking lain atau kedaluwarsa sebelum kelas dimulai" {
		t.Errorf("lot check message = %q", got)
	}
	if got := eligibility(func(in *EligibilityInput) { in.Balance, in.Reserved, in.ConfirmedCount = 5, 4, 2 }); got != deny(DenyInsufficientCredits) {
		t.Errorf("reservation also guards the waitlist: %+v", got)
	}
}

func TestPassStrikes(t *testing.T) {
	r := Rules{StrikeLimit: 3, StrikeWindowDays: 30, StrikeSuspendDays: 7}
	day := func(d int) time.Time { return at("2026-10-01T00:00:00Z").Add(time.Duration(d) * 24 * time.Hour) }
	cases := []struct {
		name    string
		strikes []time.Time
		now     time.Time
		count   int
		until   *time.Time
	}{
		{"none", nil, day(0), 0, nil},
		{"two in the window", []time.Time{day(0), day(10)}, day(11), 2, nil},
		{"third suspends from the third strike", []time.Time{day(20), day(0), day(10)}, day(21), 0, ptr(day(27))},
		{"suspension ends", []time.Time{day(0), day(10), day(20)}, day(27), 0, nil},
		{"spread past the window", []time.Time{day(0), day(10), day(31)}, day(32), 2, nil},
		{"a strike on the window edge drops out", []time.Time{day(0), day(30)}, day(30), 1, nil},
		{"count restarts after a suspension", []time.Time{day(0), day(1), day(2), day(3), day(4)}, day(5), 2, ptr(day(9))},
	}
	for _, c := range cases {
		got := EvaluatePassStrikes(c.strikes, r, c.now)
		if got.Strikes != c.count || (got.SuspendedUntil == nil) != (c.until == nil) ||
			(c.until != nil && !got.SuspendedUntil.Equal(*c.until)) {
			t.Errorf("%s: %+v", c.name, got)
		}
	}
	if got := EvaluatePassStrikes([]time.Time{day(0), day(1), day(2)}, Rules{StrikeWindowDays: 30}, day(3)); got.SuspendedUntil != nil || got.Strikes != 3 {
		t.Errorf("limit 0 never suspends: %+v", got)
	}
}

func TestStaffWaiverAndNoShowTiming(t *testing.T) {
	out := EvaluateCancellation(BookingConfirmed, start, 2, true, rules, at("2026-10-05T10:00:00Z")).Waived()
	if !out.Late || out.PassStrike || out.PenaltyCredits != 0 {
		t.Errorf("waived: %+v", out)
	}
	if CanMarkNoShow(start, start.Add(-time.Second)) || !CanMarkNoShow(start, start) {
		t.Error("no-show only once the class started")
	}
	s, e := WibDayBounds(at("2026-10-04T17:30:00Z")) // Monday 00.30 WIB
	if !s.Equal(at("2026-10-04T17:00:00Z")) || !e.Equal(at("2026-10-05T17:00:00Z")) {
		t.Errorf("WIB day = %s .. %s", s, e)
	}
}

func TestCheckInWindowAndWeeks(t *testing.T) {
	end := at("2026-10-05T12:00:00Z")
	window := Rules{CheckinOpensMinBefore: 45, CheckinClosesMinAfter: 15}
	for s, want := range map[string]bool{
		"2026-10-05T10:15:00Z": true, "2026-10-05T10:14:59Z": false,
		"2026-10-05T12:15:00Z": true, "2026-10-05T12:15:01Z": false,
	} {
		if got := IsWithinCheckInWindow(start, end, at(s), window); got != want {
			t.Errorf("window at %s = %v", s, got)
		}
	}
	// A branch that opens the gate 10 minutes early and closes it at the end.
	narrow := Rules{CheckinOpensMinBefore: 10, CheckinClosesMinAfter: 0}
	for s, want := range map[string]bool{
		"2026-10-05T10:50:00Z": true, "2026-10-05T10:49:59Z": false,
		"2026-10-05T12:00:00Z": true, "2026-10-05T12:00:01Z": false,
	} {
		if got := IsWithinCheckInWindow(start, end, at(s), narrow); got != want {
			t.Errorf("narrow window at %s = %v", s, got)
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
