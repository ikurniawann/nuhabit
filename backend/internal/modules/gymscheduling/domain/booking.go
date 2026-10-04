// Package domain holds the gym scheduling rules as pure Go: the session and
// booking state machines, booking eligibility, cancellation and no-show
// policy, the FIFO waitlist and the gate check-in pipeline. Port of
// frontend/src/lib/gym/booking.ts.
//
// Credits are checked at booking time but deducted only at check-in. A member
// who books and does not turn up is handled by the no-show policy.
package domain

import (
	"math"
	"slices"
	"sort"
	"strconv"
	"time"
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
	DenySessionNotBookable  BookingDenialReason = "session_not_bookable"
	DenyBookingNotOpenYet   BookingDenialReason = "booking_not_open_yet"
	DenyBookingWindowClosed BookingDenialReason = "booking_window_closed"
	DenyAlreadyBooked       BookingDenialReason = "already_booked"
	DenyInsufficientCredits BookingDenialReason = "insufficient_credits"
)

var BookingDenialLabel = map[BookingDenialReason]string{
	DenyMemberNotActive:     "Keanggotaan ini belum bisa booking kelas",
	DenySessionNotBookable:  "Kelas ini tidak dibuka untuk booking",
	DenyBookingNotOpenYet:   "Booking kelas ini belum dibuka",
	DenyBookingWindowClosed: "Booking kelas ini sudah ditutup",
	DenyAlreadyBooked:       "Anda sudah punya tempat di kelas ini",
	DenyInsufficientCredits: "Kredit tidak cukup untuk kelas ini",
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
	BookingOpensAt  time.Time
	BookingClosesAt time.Time
}

// EligibilityInput collects the facts eligibility is decided on.
type EligibilityInput struct {
	MemberActive         bool
	Session              BookableSession
	Balance              int
	ConfirmedCount       int
	LastWaitlistPosition int
	HasActiveBooking     bool
	Now                  time.Time
}

// EvaluateBookingEligibility checks, in this order: active member, bookable
// session, booking window, no active booking, enough credits, then a seat or
// the waitlist.
func EvaluateBookingEligibility(in EligibilityInput) BookingDecision {
	deny := func(r BookingDenialReason) BookingDecision { return BookingDecision{Kind: DecisionDeny, Reason: r} }
	switch {
	case !in.MemberActive:
		return deny(DenyMemberNotActive)
	case !slices.Contains(BookableSessionStatuses, in.Session.Status):
		return deny(DenySessionNotBookable)
	case in.Now.Before(in.Session.BookingOpensAt):
		return deny(DenyBookingNotOpenYet)
	case in.Now.After(in.Session.BookingClosesAt):
		return deny(DenyBookingWindowClosed)
	case in.HasActiveBooking:
		return deny(DenyAlreadyBooked)
	case in.Balance < in.Session.CreditCost:
		return deny(DenyInsufficientCredits)
	case in.ConfirmedCount >= in.Session.Capacity:
		return BookingDecision{Kind: DecisionWaitlist, Position: in.LastWaitlistPosition + 1}
	}
	return BookingDecision{Kind: DecisionConfirm}
}

// ── Cancellation & no-show ──────────────────────────────────────────────────

func CancellationDeadline(startsAt time.Time, rules Rules) time.Time {
	return startsAt.Add(-time.Duration(rules.CancellationDeadlineHours) * time.Hour)
}

// CancellationOutcome: Late means past the free-cancel deadline;
// PenaltyCredits are forfeited because of it.
type CancellationOutcome struct {
	Late           bool
	Deadline       time.Time
	PenaltyCredits int
}

// EvaluateCancellation: cancelling a confirmed booking after the deadline is
// late and forfeits the session credits under the forfeit policy. Leaving the
// waitlist is always free.
func EvaluateCancellation(status BookingStatus, startsAt time.Time, creditCost int, rules Rules, now time.Time) CancellationOutcome {
	deadline := CancellationDeadline(startsAt, rules)
	late := status == BookingConfirmed && now.After(deadline)
	penalty := 0
	if late && rules.LateCancelPolicy == PolicyForfeit {
		penalty = creditCost
	}
	return CancellationOutcome{Late: late, Deadline: deadline, PenaltyCredits: penalty}
}

func NoShowPenalty(creditCost int, rules Rules) int {
	if rules.NoShowPolicy == PolicyForfeit {
		return creditCost
	}
	return 0
}

// ── Waitlist ────────────────────────────────────────────────────────────────

// WaitlistEntry is a booking as the waitlist sees it.
type WaitlistEntry struct {
	ID                 string
	CustomerID         string
	Status             BookingStatus
	WaitlistPosition   *int
	CreatedAt          time.Time
	PromotionOfferedAt *time.Time
}

func positionOr(p *int, fallback int) int {
	if p == nil {
		return fallback
	}
	return *p
}

// PickWaitlistPromotion is FIFO: lowest position wins, ties broken by sign-up
// time. Entries already offered a seat are skipped.
func PickWaitlistPromotion(rows []WaitlistEntry) *WaitlistEntry {
	var candidates []WaitlistEntry
	for _, b := range rows {
		if b.Status == BookingWaitlist && b.PromotionOfferedAt == nil {
			candidates = append(candidates, b)
		}
	}
	if len(candidates) == 0 {
		return nil
	}
	sort.SliceStable(candidates, func(i, j int) bool {
		pi, pj := positionOr(candidates[i].WaitlistPosition, math.MaxInt), positionOr(candidates[j].WaitlistPosition, math.MaxInt)
		if pi != pj {
			return pi < pj
		}
		return candidates[i].CreatedAt.Before(candidates[j].CreatedAt)
	})
	return &candidates[0]
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

// PlanWaitlistPromotion gives a freed seat to the head of the queue: confirmed
// at once (auto) or offered for the member to accept (offer).
func PlanWaitlistPromotion(rows []WaitlistEntry, autoPromote bool) (*WaitlistEntry, PromotionMode) {
	booking := PickWaitlistPromotion(rows)
	if booking == nil {
		return nil, ""
	}
	if autoPromote {
		return booking, PromoteAuto
	}
	return booking, PromoteOffer
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

// WIB is Asia/Jakarta (UTC+7, no DST). A fixed zone keeps the binary free of tzdata.
var WIB = time.FixedZone("WIB", 7*3600)

// WeekStartWib returns Monday (WIB) of the week containing t, as YYYY-MM-DD.
func WeekStartWib(t time.Time) string {
	wib := t.In(WIB)
	isoDow := int(wib.Weekday())
	if isoDow == 0 {
		isoDow = 7
	}
	return wib.AddDate(0, 0, -(isoDow - 1)).Format(time.DateOnly)
}

// ShiftDays moves an instant by whole 24-hour days.
func ShiftDays(t time.Time, days int) time.Time {
	return t.Add(time.Duration(days) * 24 * time.Hour)
}

var (
	wibWeekdays = [...]string{"Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"}
	wibMonths   = [...]string{"Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"}
)

// FormatWib renders an instant the way toLocaleString("id-ID", {weekday,
// day, month: short, hour, minute, timeZone: Asia/Jakarta}) does, e.g.
// "Sen, 5 Okt, 18.00".
func FormatWib(t time.Time) string {
	w := t.In(WIB)
	return wibWeekdays[w.Weekday()] + ", " + strconv.Itoa(w.Day()) + " " + wibMonths[w.Month()-1] + ", " + w.Format("15.04")
}

// IsClassTypeCovered: nil coverage means every class type is allowed.
func IsClassTypeCovered(covered []string, classTypeID string) bool {
	return covered == nil || slices.Contains(covered, classTypeID)
}
