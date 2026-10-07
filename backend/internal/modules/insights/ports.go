package insights

import (
	"context"
	"encoding/json"

	"nuhabit/backend/internal/platform/database"
)

// Ports are what insights needs from contexts it does not own. Reads for
// reporting run as SQL in this module (the TS reads across contexts too);
// writes and the desktop overview go through these interfaces, which
// internal/app adapts.
type Ports struct {
	// Overview is buildDesktopOverview() of the desktop context. GET
	// /api/dashboard/executive is mounted only when it is wired.
	Overview DesktopOverview
	// Announcements and CandidateNotes execute confirmed Do write actions.
	// The action response returns their ids, so they run in the request.
	Announcements  AnnouncementDrafts
	CandidateNotes CandidateNotes
}

// DesktopOverview builds the desktop board for the "today" period.
type DesktopOverview interface {
	// Build returns the DesktopOverview JSON and its gagal list.
	Build(ctx context.Context) (json.RawMessage, []string, error)
}

// AnnouncementDrafts writes hris.announcements.
type AnnouncementDrafts interface {
	// CreateDraft inserts a draft announcement and returns its id and title.
	CreateDraft(ctx context.Context, q database.Querier, title, bodyHTML string, tags []string) (id, savedTitle string, err error)
}

// CandidateNotes writes recruitment.candidate_notes.
type CandidateNotes interface {
	// Add inserts an HR note on the candidate's timeline and returns its id.
	Add(ctx context.Context, q database.Querier, candidateID, content, userID, userName string) (string, error)
}
