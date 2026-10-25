// Package domain holds the gym scheduling rules as pure Go: the session and
// booking state machines, booking eligibility, cancellation and no-show
// policy, the FIFO waitlist and the gate check-in pipeline. Port of
// frontend/src/lib/gym/booking.ts.
//
// Credits are checked at booking time but deducted only at check-in. A member
// who books and does not turn up is handled by the no-show policy.
package domain

import (
	"fmt"
	"math"
	"slices"
	"sort"
	"time"

	"nuhabit/backend/internal/platform/localtime"
)

// CreditPolicy says whether credits are forfeited (late cancel, no-show).
type CreditPolicy string

const (
	PolicyForfeit CreditPolicy = "forfeit"
	PolicyFree    CreditPolicy = "free"
)

// Rules is the subset of gym.business_rules this module reads.
type Rules struct {
	CancellationDeadlineHours int
	LateCancelPolicy          CreditPolicy
	NoShowPolicy              CreditPolicy
	ReEntryGraceMin           int
	AntiPassbackMin           int
	WaitlistAutoPromote       bool
	BookingOpensDaysBefore    int
	BookingClosesMinBefore    int
	// 0 = no cap.
	MaxConcurrentBookings int
	MaxBookingsPerDay     int
	// 0 = strikes never suspend.
	StrikeLimit              int
	StrikeWindowDays         int
	StrikeSuspendDays        int
	WaitlistPromoteCutoffMin int
	WaitlistOfferMinutes     int
	// ClassReminderMinutes: remind booked members this long before class; 0 = never.
	ClassReminderMinutes int
	// ScheduleHorizonDays is how far ahead templates generate sessions.
	ScheduleHorizonDays int
	// RequireWaiver: booking and gate entry need the current waiver.
	RequireWaiver bool
	// RequireParq: booking needs a current PAR-Q health declaration.
	RequireParq bool
	// The gate admits a booking from CheckinOpensMinBefore before the start
	// until CheckinClosesMinAfter after the end (minutes).
	CheckinOpensMinBefore int
	CheckinClosesMinAfter int
	// OpenGymEnabled admits members without a booking in open gym hours;
	// OpenGymCreditCost is charged once per day in the branch zone (0 = free).
	OpenGymEnabled    bool
	OpenGymCreditCost int
	// CorrectionWindowDays: how long after the class staff may undo a
	// check-in or no-show.
	CorrectionWindowDays int
	// ChangeFreeCancelHours: members booked before the studio moved the
	// class or changed its coach may cancel free this long after the change.
	ChangeFreeCancelHours int
	// ChangeNoticeMinHours: a change announced closer to the start than this
	// is flagged late.
	ChangeNoticeMinHours int
}

// ── Sessions ────────────────────────────────────────────────────────────────

type SessionStatus string

const (
	SessionDraft     SessionStatus = "draft"
	SessionPublished SessionStatus = "published"
	SessionFull      SessionStatus = "full"
	SessionCompleted SessionStatus = "completed"
	SessionCancelled SessionStatus = "cancelled"
)

// SessionStatuses lists every session status in declaration order.
var SessionStatuses = []SessionStatus{SessionDraft, SessionPublished, SessionFull, SessionCompleted, SessionCancelled}

var sessionTransitions = map[SessionStatus][]SessionStatus{
	SessionDraft:     {SessionPublished, SessionCancelled},
	SessionPublished: {SessionFull, SessionCompleted, SessionCancelled},
	SessionFull:      {SessionPublished, SessionCompleted, SessionCancelled},
}

func CanTransitionSession(from, to SessionStatus) bool {
	return slices.Contains(sessionTransitions[from], to)
}

// BookableSessionStatuses are the statuses a member can book into.
var BookableSessionStatuses = []SessionStatus{SessionPublished, SessionFull}

// DeriveBookingWindow derives when booking opens and closes from the start time.
func DeriveBookingWindow(startsAt time.Time, rules Rules) (opensAt, closesAt time.Time) {
	opensAt = startsAt.Add(-time.Duration(rules.BookingOpensDaysBefore) * 24 * time.Hour)
	closesAt = startsAt.Add(-time.Duration(rules.BookingClosesMinBefore) * time.Minute)
	return opensAt, closesAt
}

// SessionStatusForSeats flips published and full as seats fill and free up.
// Other statuses are left alone.
func SessionStatusForSeats(status SessionStatus, confirmedCount, capacity int) SessionStatus {
	if status == SessionPublished && confirmedCount >= capacity {
		return SessionFull
	}
	if status == SessionFull && confirmedCount < capacity {
		return SessionPublished
	}
	return status
}

// ── Bookings ────────────────────────────────────────────────────────────────

type BookingStatus string

const (
	BookingConfirmed BookingStatus = "confirmed"
	BookingWaitlist  BookingStatus = "waitlist"
	BookingCancelled BookingStatus = "cancelled"
	BookingCheckedIn BookingStatus = "checked_in"
	BookingCompleted BookingStatus = "completed"
	BookingNoShow    BookingStatus = "no_show"
)

// BookingStatuses lists every booking status in declaration order.
var BookingStatuses = []BookingStatus{
	BookingConfirmed, BookingWaitlist, BookingCancelled, BookingCheckedIn, BookingCompleted, BookingNoShow,
}

var bookingTransitions = map[BookingStatus][]BookingStatus{
	BookingConfirmed: {BookingCancelled, BookingCheckedIn, BookingNoShow},
	BookingWaitlist:  {BookingConfirmed, BookingCancelled},
	BookingCheckedIn: {BookingCompleted},
}

func CanTransitionBooking(from, to BookingStatus) bool {
	return slices.Contains(bookingTransitions[from], to)
}

type BookingDenialReason string

const (
	DenyMemberNotActive     BookingDenialReason = "member_not_active"
	DenyMemberBanned        BookingDenialReason = "member_banned"
	DenyWaiverRequired      BookingDenialReason = "waiver_required"
	DenyParqRequired        BookingDenialReason = "parq_required"
	DenySessionNotBookable  BookingDenialReason = "session_not_bookable"
	DenyBookingNotOpenYet   BookingDenialReason = "booking_not_open_yet"
	DenyBookingWindowClosed BookingDenialReason = "booking_window_closed"
	DenyAlreadyBooked       BookingDenialReason = "already_booked"
	DenyPassSuspended       BookingDenialReason = "pass_suspended"
	DenyConcurrentLimit     BookingDenialReason = "concurrent_limit"
	DenyDailyLimit          BookingDenialReason = "daily_limit"
	DenyInsufficientCredits BookingDenialReason = "insufficient_credits"
	DenyClassNotCovered     BookingDenialReason = "class_not_covered"
	DenyNoOffer             BookingDenialReason = "no_offer"
	DenyOfferExpired        BookingDenialReason = "offer_expired"
	DenySeatTaken           BookingDenialReason = "seat_taken"
)

var BookingDenialLabel = map[BookingDenialReason]string{
	DenyMemberNotActive:     "Keanggotaan ini belum bisa booking kelas",
	DenyMemberBanned:        "Akun member ini diblokir. Hubungi front desk",
	DenyWaiverRequired:      "Waiver belum disetujui. Setujui waiver digital terlebih dulu untuk booking kelas",
	DenyParqRequired:        "Deklarasi kesehatan (PAR-Q) belum diisi atau sudah lewat 12 bulan. Isi dulu di aplikasi member untuk booking kelas",
	DenySessionNotBookable:  "Kelas ini tidak dibuka untuk booking",
	DenyBookingNotOpenYet:   "Booking kelas ini belum dibuka",
	DenyBookingWindowClosed: "Booking kelas ini sudah ditutup",
	DenyAlreadyBooked:       "Anda sudah punya tempat di kelas ini",
	DenyPassSuspended:       "Booking ditangguhkan karena batas strike pass tercapai",
	DenyConcurrentLimit:     "Batas booking aktif sudah tercapai",
	DenyDailyLimit:          "Batas booking per hari sudah tercapai",
	DenyInsufficientCredits: "Kredit tidak cukup untuk kelas ini",
	DenyClassNotCovered:     "Paket kredit Anda tidak mencakup kelas ini",
	DenyNoOffer:             "Belum ada kursi yang ditawarkan untuk Anda di kelas ini",
	DenyOfferExpired:        "Tawaran kursi ini sudah kedaluwarsa",
	DenySeatTaken:           "Kursi itu sudah diambil member lain",
}

type DecisionKind string

const (
	DecisionConfirm  DecisionKind = "confirm"
	DecisionWaitlist DecisionKind = "waitlist"
	DecisionDeny     DecisionKind = "deny"
)

// BookingDecision is the outcome of EvaluateBookingEligibility. Position is
// set for a waitlist decision, Reason for a denial.
type BookingDecision struct {
	Kind     DecisionKind
	Position int
	Reason   BookingDenialReason
}

// BookableSession is what eligibility needs to know about a session.
type BookableSession struct {
	Status          SessionStatus
	Capacity        int
	CreditCost      int
	StartsAt        time.Time
	BookingOpensAt  time.Time
	BookingClosesAt time.Time
}

// EligibilityInput collects the facts eligibility is decided on.
type EligibilityInput struct {
	MemberActive bool
	// Banned: a manager banned the member (gym-loyalty status).
	Banned bool
	// WaiverMissing: the rules require a waiver the member has not accepted.
	WaiverMissing bool
	// ParqMissing: the rules require a current PAR-Q declaration the member
	// does not have.
	ParqMissing bool
	Session     BookableSession
	Balance     int
	// Reserved is the credit cost of the member's other confirmed bookings
	// for classes not started yet and not covered by a pass. Those credits
	// are spoken for, so only Balance - Reserved is available.
	Reserved int
	// CreditsFit, when set, is the ledger's answer lot by lot: whether the
	// member's credits pay for this class and every reserved booking, class
	// type restrictions and expiry included. It replaces Balance - Reserved.
	CreditsFit *bool
	// HasPass: a pass covers the session start, so no credits are needed.
	HasPass bool
	// ClassNotCovered: the member's credit packages exclude this class type.
	ClassNotCovered bool
	// UpcomingConfirmed counts the member's other confirmed bookings for
	// classes not started yet; SameDayBookings their other bookings
	// (confirmed, checked in or completed) on the session's local day.
	UpcomingConfirmed int
	SameDayBookings   int
	MaxConcurrent     int
	MaxPerDay         int
	// SuspendedUntil is set while pass strikes suspend booking.
	SuspendedUntil *time.Time
	// Zone is the session's branch zone, for times in denial messages.
	Zone *time.Location
	// ConfirmedCount is the seats taken, open waitlist offers included.
	ConfirmedCount       int
	LastWaitlistPosition int
	HasActiveBooking     bool
	Now                  time.Time
	// OverrideWindow: staff book a walk-in or late arrival, so the booking
	// window does not apply.
	OverrideWindow bool
}

// Available is the balance left after the credits reserved by other bookings.
func (in EligibilityInput) Available() int { return in.Balance - in.Reserved }

// creditsShort: the member cannot pay for the class. When the ledger ran
// the lot check, a class no package covers is left to DenyClassNotCovered.
func (in EligibilityInput) creditsShort() bool {
	if in.CreditsFit != nil {
		return !*in.CreditsFit && !in.ClassNotCovered
	}
	return in.Available() < in.Session.CreditCost
}

// EvaluateBookingEligibility checks, in this order: active member, bookable
// session, booking window, no active booking, the member checks of
// EvaluateMemberEligibility, then a seat or the waitlist.
func EvaluateBookingEligibility(in EligibilityInput) BookingDecision {
	deny := func(r BookingDenialReason) BookingDecision { return BookingDecision{Kind: DecisionDeny, Reason: r} }
	switch {
	case !in.MemberActive:
		return deny(DenyMemberNotActive)
	case in.Banned:
		return deny(DenyMemberBanned)
	case !slices.Contains(BookableSessionStatuses, in.Session.Status):
		return deny(DenySessionNotBookable)
	case !in.OverrideWindow && in.Now.Before(in.Session.BookingOpensAt):
		return deny(DenyBookingNotOpenYet)
	case !in.OverrideWindow && in.Now.After(in.Session.BookingClosesAt):
		return deny(DenyBookingWindowClosed)
	case in.HasActiveBooking:
		return deny(DenyAlreadyBooked)
	}
	if reason := EvaluateMemberEligibility(in); reason != "" {
		return deny(reason)
	}
	if in.ConfirmedCount >= in.Session.Capacity {
		return BookingDecision{Kind: DecisionWaitlist, Position: in.LastWaitlistPosition + 1}
	}
	return BookingDecision{Kind: DecisionConfirm}
}

// EvaluateMemberEligibility is what a member must meet to hold a seat,
// checked at booking and again before a waitlist promotion or an accepted
// offer: active, not banned, waiver accepted, not suspended, under the booking caps, then
// enough available credits and a package covering the class (a pass waives
// both). It returns "" when the member qualifies.
func EvaluateMemberEligibility(in EligibilityInput) BookingDenialReason {
	switch {
	case !in.MemberActive:
		return DenyMemberNotActive
	case in.Banned:
		return DenyMemberBanned
	case in.WaiverMissing:
		return DenyWaiverRequired
	case in.ParqMissing:
		return DenyParqRequired
	case in.SuspendedUntil != nil && in.Now.Before(*in.SuspendedUntil):
		return DenyPassSuspended
	case in.MaxConcurrent > 0 && in.UpcomingConfirmed >= in.MaxConcurrent:
		return DenyConcurrentLimit
	case in.MaxPerDay > 0 && in.SameDayBookings >= in.MaxPerDay:
		return DenyDailyLimit
	case in.HasPass:
		return ""
	case in.creditsShort():
		return DenyInsufficientCredits
	case in.ClassNotCovered:
		return DenyClassNotCovered
	}
	return ""
}

// DenialMessage is the reason shown to the member or staff, with the
// numbers behind a credit, cap or suspension denial.
func (in EligibilityInput) DenialMessage(r BookingDenialReason) string {
	switch r {
	case DenyInsufficientCredits:
		switch {
		case in.CreditsFit != nil && in.Available() >= in.Session.CreditCost:
			// The balance looks enough, but the lot check failed.
			return "Kredit tidak cukup untuk kelas ini: kredit yang berlaku sudah dipesan untuk booking lain atau kedaluwarsa sebelum kelas dimulai"
		case in.Reserved > 0:
			return fmt.Sprintf("Kredit tidak cukup untuk kelas ini: tersedia %d, butuh %d (%d kredit sudah terpakai untuk booking lain)",
				max(in.Available(), 0), in.Session.CreditCost, in.Reserved)
		}
	case DenyConcurrentLimit:
		return fmt.Sprintf("Batas booking aktif tercapai: maksimal %d kelas mendatang", in.MaxConcurrent)
	case DenyDailyLimit:
		return fmt.Sprintf("Batas booking tercapai: maksimal %d kelas per hari", in.MaxPerDay)
	case DenyPassSuspended:
		return "Booking ditangguhkan sampai " + localtime.Format(*in.SuspendedUntil, in.Zone) +
			" karena batas strike pass tercapai (batal terlambat atau tidak hadir)"
	}
	return BookingDenialLabel[r]
}

// ── Pass strikes ────────────────────────────────────────────────────────────

// StrikeStatus: Strikes count toward the limit now; SuspendedUntil is set
// while booking is suspended.
type StrikeStatus struct {
	Strikes        int
	SuspendedUntil *time.Time
}

// EvaluatePassStrikes walks the strikes oldest first. A strike counts while
// it is inside the strike window. Reaching the limit suspends booking for
// StrikeSuspendDays from that strike and starts the count again, so the
// strikes behind one suspension never trigger a second one.
func EvaluatePassStrikes(strikes []time.Time, rules Rules, now time.Time) StrikeStatus {
	sorted := slices.Clone(strikes)
	slices.SortFunc(sorted, func(a, b time.Time) int { return a.Compare(b) })
	window := time.Duration(rules.StrikeWindowDays) * 24 * time.Hour
	inWindow := func(list []time.Time, at time.Time) []time.Time {
		return slices.DeleteFunc(list, func(s time.Time) bool { return !s.After(at.Add(-window)) })
	}
	var counted []time.Time
	var until time.Time
	for _, at := range sorted {
		counted = append(inWindow(counted, at), at)
		if rules.StrikeLimit > 0 && len(counted) >= rules.StrikeLimit {
			until = at.Add(time.Duration(rules.StrikeSuspendDays) * 24 * time.Hour)
			counted = nil
		}
	}
	out := StrikeStatus{Strikes: len(inWindow(counted, now))}
	if now.Before(until) {
		out.SuspendedUntil = &until
	}
	return out
}

// ── Cancellation & no-show ──────────────────────────────────────────────────

func CancellationDeadline(startsAt time.Time, rules Rules) time.Time {
	return startsAt.Add(-time.Duration(rules.CancellationDeadlineHours) * time.Hour)
}

// CancellationOutcome: Late means past the free-cancel deadline;
// PenaltyCredits are forfeited because of it, or PassStrike is recorded
// when a pass covers the session (a pass holder has no credits to forfeit).
type CancellationOutcome struct {
	Late           bool
	Deadline       time.Time
	PenaltyCredits int
	PassStrike     bool
}

// EvaluateCancellation: cancelling a confirmed booking after the deadline is
// late and forfeits the session credits under the forfeit policy, or counts
// a strike against a pass. Leaving the waitlist is always free.
func EvaluateCancellation(status BookingStatus, startsAt time.Time, creditCost int, hasPass bool, rules Rules, now time.Time) CancellationOutcome {
	deadline := CancellationDeadline(startsAt, rules)
	late := status == BookingConfirmed && now.After(deadline)
	out := CancellationOutcome{Late: late, Deadline: deadline}
	if late && rules.LateCancelPolicy == PolicyForfeit {
		if hasPass {
			out.PassStrike = true
		} else {
			out.PenaltyCredits = creditCost
		}
	}
	return out
}

// NoShowPenalty is the credits forfeited for not turning up; a pass holder
// gets a strike instead (PassStrike).
func NoShowPenalty(creditCost int, hasPass bool, rules Rules) (penalty int, passStrike bool) {
	if rules.NoShowPolicy != PolicyForfeit {
		return 0, false
	}
	if hasPass {
		return 0, true
	}
	return creditCost, false
}

// Waived drops the penalty and the strike: staff cancelled for the member
// without charging. Late stays as it was.
func (o CancellationOutcome) Waived() CancellationOutcome {
	o.PenaltyCredits, o.PassStrike = 0, false
	return o
}

// CanMarkNoShow: a member is absent only once the class has started.
func CanMarkNoShow(startsAt, now time.Time) bool { return !now.Before(startsAt) }

// ── Waitlist ────────────────────────────────────────────────────────────────

// WaitlistEntry is a booking as the waitlist sees it.
type WaitlistEntry struct {
	ID                 string
	CustomerID         string
	Status             BookingStatus
	WaitlistPosition   *int
	CreatedAt          time.Time
	PromotionOfferedAt *time.Time
	// Rank is the member's tier rank when the tier has waitlist priority,
	// 0 otherwise.
	Rank int
}

func positionOr(p *int, fallback int) int {
	if p == nil {
		return fallback
	}
	return *p
}

// WaitlistQueue is the promotion order: higher tier rank first, then FIFO
// (lowest position first, ties broken by sign-up time). Entries already
// offered a seat are left out.
func WaitlistQueue(rows []WaitlistEntry) []WaitlistEntry {
	var queue []WaitlistEntry
	for _, b := range rows {
		if b.Status == BookingWaitlist && b.PromotionOfferedAt == nil {
			queue = append(queue, b)
		}
	}
	sort.SliceStable(queue, func(i, j int) bool {
		if queue[i].Rank != queue[j].Rank {
			return queue[i].Rank > queue[j].Rank
		}
		pi, pj := positionOr(queue[i].WaitlistPosition, math.MaxInt), positionOr(queue[j].WaitlistPosition, math.MaxInt)
		if pi != pj {
			return pi < pj
		}
		return queue[i].CreatedAt.Before(queue[j].CreatedAt)
	})
	return queue
}

func NextWaitlistPosition(rows []WaitlistEntry) int {
	highest := 0
	for _, b := range rows {
		if b.Status == BookingWaitlist {
			highest = max(highest, positionOr(b.WaitlistPosition, 0))
		}
	}
	return highest + 1
}

type PromotionMode string

const (
	PromoteAuto  PromotionMode = "auto"
	PromoteOffer PromotionMode = "offer"
)

// CanPromoteWaitlist: seats move up from the waitlist only while the
// session is open, its booking window has not closed and it has not started.
func CanPromoteWaitlist(s BookableSession, now time.Time) bool {
	return slices.Contains(BookableSessionStatuses, s.Status) && !now.After(s.BookingClosesAt) && now.Before(s.StartsAt)
}

// HoldsSeat: a confirmed booking takes a seat, and so does a waitlist offer
// until it lapses.
func HoldsSeat(status BookingStatus, offerExpiresAt *time.Time, now time.Time) bool {
	return status == BookingConfirmed || (status == BookingWaitlist && offerExpiresAt != nil && now.Before(*offerExpiresAt))
}

// FreeSeats is what is left for the waitlist once confirmed seats and open
// offers are counted.
func FreeSeats(capacity, taken, offered int) int { return max(capacity-taken-offered, 0) }

// WaitlistPromotionMode: a freed seat is confirmed at once (auto) unless
// auto promotion is off or the class starts within the cutoff. Then the seat
// is offered for the member to accept.
func WaitlistPromotionMode(rules Rules, startsAt, now time.Time) PromotionMode {
	cutoff := startsAt.Add(-time.Duration(rules.WaitlistPromoteCutoffMin) * time.Minute)
	if rules.WaitlistAutoPromote && now.Before(cutoff) {
		return PromoteAuto
	}
	return PromoteOffer
}

// OfferExpiry is when an offer made now lapses: WaitlistOfferMinutes from
// now, but never after booking closes.
func OfferExpiry(rules Rules, closesAt, now time.Time) time.Time {
	expires := now.Add(time.Duration(rules.WaitlistOfferMinutes) * time.Minute)
	if expires.After(closesAt) {
		return closesAt
	}
	return expires
}

// OfferInput is what accepting an offered seat is decided on. SeatsTaken
// counts confirmed seats plus the other open offers.
type OfferInput struct {
	Status     BookingStatus
	OfferedAt  *time.Time
	ExpiresAt  *time.Time
	Session    BookableSession
	SeatsTaken int
	Now        time.Time
}

// EvaluateOfferAcceptance returns "" when the member may take the seat: the
// offer exists, booking is still open, the offer has not lapsed and the
// seat is free. The member checks run separately (EvaluateMemberEligibility).
func EvaluateOfferAcceptance(in OfferInput) BookingDenialReason {
	switch {
	case in.Status != BookingWaitlist || in.OfferedAt == nil:
		return DenyNoOffer
	case !CanPromoteWaitlist(in.Session, in.Now):
		return DenyBookingWindowClosed
	case in.ExpiresAt != nil && !in.Now.Before(*in.ExpiresAt):
		return DenyOfferExpired
	case in.SeatsTaken >= in.Session.Capacity:
		return DenySeatTaken
	}
	return ""
}

// ── Closing a session ───────────────────────────────────────────────────────

// BookingStatusOnComplete: checked in becomes completed, confirmed but absent
// becomes no-show, waitlist is cancelled.
func BookingStatusOnComplete(status BookingStatus) BookingStatus {
	switch status {
	case BookingCheckedIn:
		return BookingCompleted
	case BookingConfirmed:
		return BookingNoShow
	case BookingWaitlist:
		return BookingCancelled
	}
	return status
}

// ── Week helpers ────────────────────────────────────────────────────────────

// ShiftDays moves an instant by whole 24-hour days.
func ShiftDays(t time.Time, days int) time.Time {
	return t.Add(time.Duration(days) * 24 * time.Hour)
}

// IsClassTypeCovered: nil coverage means every class type is allowed.
func IsClassTypeCovered(covered []string, classTypeID string) bool {
	return covered == nil || slices.Contains(covered, classTypeID)
}
