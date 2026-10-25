package domain

import (
	"cmp"
	"slices"
	"strings"
	"time"
)

// CoverStatus is the state of one affected session of a coach's leave.
//
//	open      needs a substitute
//	requested the coach on leave asked SubstituteID, who answers by RespondBy
//	accepted  the substitute agreed
//	declined  the substitute said no; the coach may ask someone else
//	assigned  the Program Director appointed the substitute
//	cancelled the Program Director calls the session off
//	void      the leave was rejected or cancelled, or the session is no
//	          longer affected
//
// The leave can be approved once no cover is open, requested or declined.
type CoverStatus string

const (
	CoverOpen      CoverStatus = "open"
	CoverRequested CoverStatus = "requested"
	CoverAccepted  CoverStatus = "accepted"
	CoverDeclined  CoverStatus = "declined"
	CoverAssigned  CoverStatus = "assigned"
	CoverCancelled CoverStatus = "cancelled"
	CoverVoid      CoverStatus = "void"
)

// Resolved: the session has a substitute or will be cancelled.
func (s CoverStatus) Resolved() bool {
	return s == CoverAccepted || s == CoverAssigned || s == CoverCancelled
}

// Blocking: the cover still stops the leave from being approved.
func (s CoverStatus) Blocking() bool { return s != CoverVoid && !s.Resolved() }

// CoverEvent is what happens to a cover.
type CoverEvent string

const (
	// EventRequest: the coach on leave asks a substitute.
	EventRequest CoverEvent = "request"
	// EventAccept and EventDecline: the substitute answers.
	EventAccept  CoverEvent = "accept"
	EventDecline CoverEvent = "decline"
	// EventExpire: the substitute did not answer in time.
	EventExpire CoverEvent = "expire"
	// EventAssign and EventCancel: the Program Director decides, over any
	// answer so far.
	EventAssign CoverEvent = "assign"
	EventCancel CoverEvent = "cancel"
	// EventVoid: the leave was rejected or cancelled, or the session left the leave.
	EventVoid CoverEvent = "void"
)

// Transition is the status after ev, or ok=false when ev does not apply.
func Transition(from CoverStatus, ev CoverEvent) (CoverStatus, bool) {
	if from == CoverVoid {
		return from, false
	}
	switch ev {
	case EventRequest:
		if from == CoverOpen || from == CoverDeclined {
			return CoverRequested, true
		}
	case EventAccept:
		if from == CoverRequested {
			return CoverAccepted, true
		}
	case EventDecline:
		if from == CoverRequested {
			return CoverDeclined, true
		}
	case EventExpire:
		if from == CoverRequested {
			return CoverOpen, true
		}
	case EventAssign:
		return CoverAssigned, true
	case EventCancel:
		return CoverCancelled, true
	case EventVoid:
		return CoverVoid, true
	}
	return from, false
}

// Blockers counts the covers that still stop the approval.
func Blockers(statuses []CoverStatus) int {
	n := 0
	for _, s := range statuses {
		if s.Blocking() {
			n++
		}
	}
	return n
}

// DefaultResponseHours is how long a substitute has to answer by default.
const DefaultResponseHours = 24

// RespondBy is the substitute's deadline: hours from now, but no later than
// an hour before the session so the Program Director can still appoint
// someone; a session less than an hour away gives 15 minutes.
func RespondBy(now time.Time, hours int, sessionStart time.Time) time.Time {
	byHours := now.Add(time.Duration(hours) * time.Hour)
	latest := sessionStart.Add(-time.Hour)
	if !latest.After(now) {
		latest = now.Add(15 * time.Minute)
	}
	if byHours.Before(latest) {
		return byHours
	}
	return latest
}

// Candidate is a coach who could take over a session.
type Candidate struct {
	CoachID string `json:"coach_id"`
	Name    string `json:"name"`
	// Clash: another class, PT session or cover claim at that time.
	Clash bool `json:"clash"`
	// OnLeave: approved leave or time off that day.
	OnLeave bool `json:"on_leave"`
	// Qualified: taught this class type before, or for PT keeps PT hours.
	Qualified bool `json:"qualified"`
	// WeekLoad counts the coach's sessions that week.
	WeekLoad int `json:"week_load"`
}

// RankSubstitutes keeps the free coaches (no clash, not on leave, and for
// personal training qualified) and orders them qualified first, then the
// lightest week, then by name.
func RankSubstitutes(list []Candidate, personal bool) []Candidate {
	out := slices.DeleteFunc(slices.Clone(list), func(c Candidate) bool {
		return c.Clash || c.OnLeave || (personal && !c.Qualified)
	})
	slices.SortStableFunc(out, func(a, b Candidate) int {
		if a.Qualified != b.Qualified {
			if a.Qualified {
				return -1
			}
			return 1
		}
		return cmp.Or(cmp.Compare(a.WeekLoad, b.WeekLoad), strings.Compare(strings.ToLower(a.Name), strings.ToLower(b.Name)))
	})
	return out
}
