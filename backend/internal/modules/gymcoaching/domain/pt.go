// Package domain holds the personal training and assessment rules of
// gym-coaching: appointment states, coach availability and free slots,
// cancellation and no-show penalties, and assessment validation.
package domain

import (
	"strconv"
	"time"
)

// Status is the state of an appointment or of one participant in it.
// NoShow is a participant state only.
type Status string

const (
	Requested Status = "requested"
	Confirmed Status = "confirmed"
	Completed Status = "completed"
	Cancelled Status = "cancelled"
	NoShow    Status = "no_show"
)

// Open statuses still hold the coach and the member's credits.
func (s Status) Open() bool { return s == Requested || s == Confirmed }

// MaxCapacity is the largest small group PT.
const MaxCapacity = 4

// MemberHorizonDays is how far ahead a member may request a session.
const MemberHorizonDays = 28

// SlotStep is the spacing of slot starts offered to members.
const SlotStep = 30 * time.Minute

// Policy says whether credits are forfeited on a late cancel or a no-show.
type Policy string

const (
	Forfeit Policy = "forfeit"
	Free    Policy = "free"
)

// Rules are the gym business rules PT follows, read per branch.
type Rules struct {
	CancellationDeadlineHours int
	LateCancelPolicy          Policy
	NoShowPolicy              Policy
	ReminderMinutes           int
}

// CanTransition lists the moves an appointment or a participant may make.
func CanTransition(from, to Status) bool {
	switch from {
	case Requested:
		return to == Confirmed || to == Cancelled
	case Confirmed:
		return to == Completed || to == Cancelled || to == NoShow
	}
	return false
}

// EarliestRequest is the first start a member may request at now: past the
// free cancellation deadline, and at least an hour away.
func EarliestRequest(now time.Time, rules Rules) time.Time {
	return now.Add(time.Duration(max(rules.CancellationDeadlineHours, 1)) * time.Hour)
}

// RequestProblem explains why a member may not request startsAt, "" when
// the time is fine.
func RequestProblem(startsAt, now time.Time, rules Rules) string {
	if startsAt.Before(EarliestRequest(now, rules)) {
		return "Sesi PT harus diminta paling lambat " + strconv.Itoa(max(rules.CancellationDeadlineHours, 1)) + " jam sebelum mulai"
	}
	if startsAt.After(now.AddDate(0, 0, MemberHorizonDays)) {
		return "Sesi PT hanya bisa diminta sampai " + strconv.Itoa(MemberHorizonDays) + " hari ke depan"
	}
	return ""
}

// HasCredits reports whether usable credits cover cost on top of what the
// member's other open PT sessions will take.
func HasCredits(usable, committed, cost int) bool { return usable-committed >= cost }

// CancelOutcome is the result of a participant cancelling.
type CancelOutcome struct {
	Late    bool
	Penalty int
}

// EvaluateCancel: cancelling a confirmed session after the free deadline is
// late and forfeits its credits under the forfeit policy. A request that the
// coach has not confirmed yet is always free to withdraw.
func EvaluateCancel(status Status, startsAt time.Time, creditCost int, rules Rules, now time.Time) CancelOutcome {
	deadline := startsAt.Add(-time.Duration(rules.CancellationDeadlineHours) * time.Hour)
	out := CancelOutcome{Late: status == Confirmed && now.After(deadline)}
	if out.Late && rules.LateCancelPolicy == Forfeit {
		out.Penalty = creditCost
	}
	return out
}

// NoShowPenalty is the credits forfeited for missing a session.
func NoShowPenalty(creditCost int, rules Rules) int {
	if rules.NoShowPolicy != Forfeit {
		return 0
	}
	return creditCost
}

// Started reports whether a session has begun: only then can it complete or
// a participant be marked absent.
func Started(startsAt, now time.Time) bool { return !now.Before(startsAt) }

// ReminderDue reports whether a session starting at startsAt is inside its
// reminder window: not started, and at most minutes away. minutes <= 0
// turns reminders off.
func ReminderDue(startsAt, now time.Time, minutes int) bool {
	if minutes <= 0 || !now.Before(startsAt) {
		return false
	}
	return !now.Before(startsAt.Add(-time.Duration(minutes) * time.Minute))
}

// ReminderPeriod keys the sent log by start time, so a moved session earns
// a fresh reminder.
func ReminderPeriod(startsAt time.Time) string { return startsAt.UTC().Format(time.RFC3339) }
