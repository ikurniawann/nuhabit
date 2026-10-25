// Package domain holds the event calendar rules: which entries clash, when
// a reminder is due, and the ICS rendering of a calendar.
package domain

import (
	"strings"
	"time"

	eventsc "nuhabit/backend/internal/contracts/events"
	"nuhabit/backend/internal/platform/localtime"
)

// Entry is one line of the unified calendar: a CRM event, a site event, a
// class session or a PT appointment.
type Entry struct {
	Kind      eventsc.Kind
	ID        string
	Title     string
	BranchID  *string
	Area      *string
	CoachID   *string
	CoachName *string
	StartsAt  time.Time
	EndsAt    time.Time
	// Zone is the branch zone the times read in; nil is Jakarta.
	Zone *time.Location
}

// Clash reasons.
const (
	ReasonRoom   = "room"
	ReasonCoach  = "coach"
	ReasonBranch = "branch"
)

var kindLabel = map[eventsc.Kind]string{
	eventsc.KindCRMEvent:  "event",
	eventsc.KindSiteEvent: "event situs",
	eventsc.KindClass:     "kelas",
	eventsc.KindPT:        "sesi PT",
}

// overlaps treats entries as [start, end): back-to-back slots do not clash.
func overlaps(aStart, aEnd, bStart, bEnd time.Time) bool {
	return aStart.Before(bEnd) && bStart.Before(aEnd)
}

func roomKey(branchID, area *string) (string, bool) {
	if area == nil || strings.TrimSpace(*area) == "" {
		return "", false
	}
	branch := ""
	if branchID != nil {
		branch = *branchID
	}
	return branch + "|" + strings.ToLower(strings.TrimSpace(*area)), true
}

func sameBranch(a, b *string) bool { return a != nil && b != nil && *a == *b }

// Detect compares the subject with the other entries of its branch and
// coach. Same coach or same room (branch and area) block the save; a class
// in the same branch at another room is a warning, so marketing sees the
// capacity impact. Entries with the subject's own ID and source are skipped.
func Detect(s eventsc.Subject, others []Entry) eventsc.Report {
	var r eventsc.Report
	room, hasRoom := roomKey(s.BranchID, s.Area)
	self := ownKind(s.Source)
	for _, o := range others {
		if (o.Kind == self && o.ID == s.ID) || !overlaps(s.StartsAt, s.EndsAt, o.StartsAt, o.EndsAt) {
			continue
		}
		switch {
		case s.CoachID != nil && o.CoachID != nil && *s.CoachID == *o.CoachID:
			r.Blocking = append(r.Blocking, clash(ReasonCoach, o))
		case hasRoom && sameRoom(room, o):
			r.Blocking = append(r.Blocking, clash(ReasonRoom, o))
		case o.Kind == eventsc.KindClass && sameBranch(s.BranchID, o.BranchID):
			r.Warnings = append(r.Warnings, clash(ReasonBranch, o))
		}
	}
	return r
}

func sameRoom(room string, o Entry) bool {
	other, ok := roomKey(o.BranchID, o.Area)
	return ok && other == room
}

func ownKind(src eventsc.Source) eventsc.Kind {
	if src == eventsc.SourceSite {
		return eventsc.KindSiteEvent
	}
	return eventsc.KindCRMEvent
}

func clash(reason string, o Entry) eventsc.Clash {
	return eventsc.Clash{Reason: reason, Kind: o.Kind, ID: o.ID, Title: o.Title, StartsAt: o.StartsAt, EndsAt: o.EndsAt,
		Area: o.Area, CoachName: o.CoachName, Message: message(reason, o)}
}

// message is the Indonesian line staff read, in the other entry's zone.
func message(reason string, o Entry) string {
	when := localtime.FormatSpan(o.StartsAt, o.EndsAt, o.Zone)
	what := kindLabel[o.Kind] + " " + o.Title
	switch reason {
	case ReasonCoach:
		name := "Coach ini"
		if o.CoachName != nil {
			name = "Coach " + *o.CoachName
		}
		return name + " sudah mengisi " + what + " pada " + when
	case ReasonRoom:
		return "Area " + strings.TrimSpace(*o.Area) + " sudah dipakai " + what + " pada " + when
	}
	return "Waktunya beririsan dengan " + what + " di cabang yang sama pada " + when
}
