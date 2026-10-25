// Package events is the contract between the event calendar module and the
// contexts that write events (CRM engagement, site): the subject of a
// conflict check, its report, the override that saves over a clash and the
// change notice that fans out to the involved parties.
package events

import (
	"context"
	"net/http"
	"strings"
	"time"

	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
)

// Source names the table an event row lives in.
type Source string

const (
	SourceCRM  Source = "crm"
	SourceSite Source = "site"
)

// Kind is one line of the unified calendar.
type Kind string

const (
	KindCRMEvent  Kind = "crm_event"
	KindSiteEvent Kind = "site_event"
	KindClass     Kind = "class"
	KindPT        Kind = "pt"
)

// Subject is the event being saved as the calendar sees it. ID is empty on
// a create.
type Subject struct {
	Source   Source
	ID       string
	Title    string
	BranchID *string
	Area     *string
	CoachID  *string
	StartsAt time.Time
	EndsAt   time.Time
}

// Clash is one calendar entry that overlaps the subject in time.
type Clash struct {
	// Reason is "room" (same branch and area), "coach" (same coach) or
	// "branch" (a class in the same branch, another room: a warning).
	Reason    string    `json:"reason"`
	Kind      Kind      `json:"kind"`
	ID        string    `json:"id"`
	Title     string    `json:"title"`
	StartsAt  time.Time `json:"starts_at"`
	EndsAt    time.Time `json:"ends_at"`
	Area      *string   `json:"area"`
	CoachName *string   `json:"coach_name"`
	// Message is the Indonesian line shown to staff.
	Message string `json:"message"`
}

// Report is the outcome of a conflict check.
type Report struct {
	Blocking []Clash `json:"blocking"`
	Warnings []Clash `json:"warnings"`
}

// Blocked reports whether the save needs an override.
func (r Report) Blocked() bool { return len(r.Blocking) > 0 }

// ConflictCode is the error code of a refused save; the client offers
// "tetap simpan" with a reason.
const ConflictCode = "event_conflict"

// Refusal is the 409 a blocked save returns: the clashes in the params so
// the client can list them.
func (r Report) Refusal() *httpx.Error {
	lines := make([]string, len(r.Blocking))
	for i, c := range r.Blocking {
		lines[i] = c.Message
	}
	return httpx.Coded(http.StatusConflict, ConflictCode, "Jadwal bentrok: "+strings.Join(lines, "; "),
		map[string]any{"blocking": r.Blocking, "warnings": r.Warnings})
}

// Override is an explicit "tetap simpan" over a blocking clash.
type Override struct {
	UserID string
	Reason string
}

// ChangeKind says what happened to the event.
type ChangeKind string

const (
	ChangeCreated     ChangeKind = "created"
	ChangeUpdated     ChangeKind = "updated"
	ChangeTimeChanged ChangeKind = "time_changed"
	ChangeCancelled   ChangeKind = "cancelled"
)

// Change is an event write the involved parties hear about.
type Change struct {
	Kind    ChangeKind
	Subject Subject
	// OrganiserUserID is the staff member in charge; nil when none is set.
	OrganiserUserID *string
	// ActorUserID made the change and is not notified.
	ActorUserID string
	// PreviousStartsAt is the start before a time change.
	PreviousStartsAt *time.Time
	// NotifyMembers sends registered members the time change or
	// cancellation. The engagement cancel path tells them itself.
	NotifyMembers bool
}

// Calendar is what the event writers call; the events module implements it.
type Calendar interface {
	// Lock serializes timetable writes for the rest of the transaction,
	// with the same key the class schedule uses.
	Lock(ctx context.Context, q database.Querier) error
	// Check lists the clashes of subject with every other calendar entry.
	Check(ctx context.Context, q database.Querier, s Subject) (Report, error)
	// RecordOverride stores who saved s over the report's clashes and why.
	RecordOverride(ctx context.Context, q database.Querier, s Subject, o Override, r Report) error
	// Notify tells the organiser, assigned staff, overlapping coaches, the
	// branch front desk and, when asked, registered members.
	Notify(ctx context.Context, q database.Querier, c Change) error
}
