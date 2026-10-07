package recruitment

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/recruitment/domain"
	"nuhabit/backend/internal/platform/httpx"
)

// candidatePage is the GET /api/candidates body.
type candidatePage struct {
	Data []*Row   `json:"data"`
	Meta pageMeta `json:"meta"`
}

type pageMeta struct {
	Total       int  `json:"total"`
	Page        int  `json:"page"`
	Limit       int  `json:"limit"`
	TotalPages  int  `json:"totalPages"`
	HasNextPage bool `json:"hasNextPage"`
	HasPrevPage bool `json:"hasPrevPage"`
}

// ListCandidates pages the candidate list (all=true returns every row).
func (s *Service) ListCandidates(ctx context.Context, q candidateListQuery) (candidatePage, error) {
	rows, total, err := s.repo.ListCandidates(ctx, s.db, q)
	if err != nil {
		return candidatePage{}, err
	}
	limit, page := q.Limit, q.Page
	if q.All {
		limit, page = max(total, 1), 1
	}
	pages := int(math.Ceil(float64(total) / float64(limit)))
	return candidatePage{Data: rows, Meta: pageMeta{
		Total: total, Page: page, Limit: limit, TotalPages: pages,
		HasNextPage: page < pages, HasPrevPage: page > 1,
	}}, nil
}

// CreateCandidate inserts a manual candidate.
func (s *Service) CreateCandidate(ctx context.Context, in candidateFields, actor Actor) (*Row, error) {
	cols, vals := in.columns(false)
	return s.repo.InsertCandidate(ctx, s.db, cols, vals, actor.ID)
}

// GetCandidate returns a candidate with its brand and position, 404 when
// the id is not a uuid or the row is missing.
func (s *Service) GetCandidate(ctx context.Context, id string) (*Row, error) {
	var row *Row
	if domain.IsUUID(id) {
		var err error
		if row, err = s.repo.GetCandidate(ctx, s.db, id); err != nil {
			return nil, err
		}
	}
	if row == nil {
		return nil, httpx.NotFound(msgCandidateNotFound)
	}
	return row, nil
}

// UpdateCandidate patches the allowlisted profile columns that were sent.
func (s *Service) UpdateCandidate(ctx context.Context, id string, in candidateFields) (*Row, error) {
	cols, vals := in.columns(true)
	return s.repo.UpdateCandidate(ctx, s.db, id, cols, vals)
}

// AddNote stores an internal note and its activity atomically.
func (s *Service) AddNote(ctx context.Context, id, content string, actor Actor) (*Row, error) {
	var note *Row
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		var err error
		if note, err = s.repo.InsertNote(ctx, tx, id, content, actor); err != nil {
			return err
		}
		_, err = s.repo.LogActivity(ctx, tx, id, "note_added", "Catatan internal ditambahkan", actor)
		return err
	})
	return note, err
}

// stageResult is the /stage response payload.
type stageResult struct {
	Status   string  `json:"status"`
	Previous *string `json:"previous,omitempty"`
}

// MoveStage moves a candidate to status with an audited activity; the same
// status is a no-op.
func (s *Service) MoveStage(ctx context.Context, id, status string, actor Actor) (stageResult, string, error) {
	current, err := s.requireCandidate(ctx, id)
	if err != nil {
		return stageResult{}, "", err
	}
	if current == status {
		return stageResult{Status: status}, "Status tidak berubah", nil
	}
	from, ok := domain.StatusLabel(current)
	if !ok {
		from = current
	}
	to, _ := domain.StatusLabel(status)
	err = s.inTx(ctx, func(tx pgx.Tx) error {
		if err := s.repo.SetCandidateStatus(ctx, tx, id, status); err != nil {
			return err
		}
		_, err := s.repo.LogActivity(ctx, tx, id, "status_change", fmt.Sprintf("Tahap diubah: %s → %s", from, to), actor)
		return err
	})
	return stageResult{Status: status, Previous: &current}, "Kandidat dipindahkan ke " + to, err
}

// SaveScreening upserts the screening result and its activity atomically.
func (s *Service) SaveScreening(ctx context.Context, id string, in screeningInput, actor Actor) (*Row, error) {
	var saved *Row
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		var err error
		if saved, err = s.repo.UpsertScreening(ctx, tx, id, in, actor); err != nil {
			return err
		}
		_, err = s.repo.LogActivity(ctx, tx, id, "screening_updated", "Hasil screening disimpan"+domain.RecommendationSuffix(in.Recommendation), actor)
		return err
	})
	return saved, err
}

// SavePsikotesSummary upserts the psikotes recommendation and its activity.
func (s *Service) SavePsikotesSummary(ctx context.Context, id string, in psikotesSummaryInput, actor Actor) (*Row, error) {
	var saved *Row
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		var err error
		if saved, err = s.repo.UpsertPsikotesSummary(ctx, tx, id, in, actor); err != nil {
			return err
		}
		_, err = s.repo.LogActivity(ctx, tx, id, "psikotes_summary_updated", "Rekomendasi psikotes disimpan"+domain.RecommendationSuffix(in.Recommendation), actor)
		return err
	})
	return saved, err
}

type proctorTally struct {
	Flags     int `json:"flags"`
	Snapshots int `json:"snapshots"`
}

func tallyProctor(counts []proctorCount) map[string]*proctorTally {
	out := map[string]*proctorTally{}
	for _, c := range counts {
		t := out[c.SessionID]
		if t == nil {
			t = &proctorTally{}
			out[c.SessionID] = t
		}
		if c.EventType == "webcam_snapshot" {
			t.Snapshots += c.N
		} else {
			t.Flags += c.N
		}
	}
	return out
}

// attachSessions decorates each session with token (role-gated), proctor
// tally and its children grouped by session_id under childKey.
func attachSessions(sessions, children []*Row, counts []proctorCount, role, childKey string) []*Row {
	bySession := map[string][]*Row{}
	for _, c := range children {
		sid := c.Str("session_id")
		bySession[sid] = append(bySession[sid], c)
	}
	tallies := tallyProctor(counts)
	for _, s := range sessions {
		if !domain.CanSeePortalToken(role) {
			s.Set("token", nil)
		}
		id := s.Str("id")
		tally := tallies[id]
		if tally == nil {
			tally = &proctorTally{}
		}
		s.Set("proctor", tally)
		kids := bySession[id]
		if kids == nil {
			kids = []*Row{}
		}
		s.Set(childKey, kids)
	}
	return sessions
}

// PsikotesPanel is the HR psikotes panel of a candidate.
func (s *Service) PsikotesPanel(ctx context.Context, id string, role string) (*Row, error) {
	summary, sessions, tests, proctor, err := s.repo.PsikotesPanel(ctx, s.db, id)
	if err != nil {
		return nil, err
	}
	var sum any
	if summary != nil {
		sum = summary
	}
	return object("summary", sum, "sessions", attachSessions(sessions, tests, proctor, role, "tests")), nil
}

// InterviewPanel is the HR interview AI panel of a candidate.
func (s *Service) InterviewPanel(ctx context.Context, id string, role string) (*Row, error) {
	sessions, turns, proctor, err := s.repo.InterviewPanel(ctx, s.db, id)
	if err != nil {
		return nil, err
	}
	return object("sessions", attachSessions(sessions, turns, proctor, role, "turns")), nil
}

// InvitePsikotes creates a psikotes session for the chosen active
// instruments, its tests and the activity in one transaction.
func (s *Service) InvitePsikotes(ctx context.Context, id string, in psikotesInviteInput, actor Actor) (*Row, error) {
	if _, err := s.requireCandidate(ctx, id); err != nil {
		return nil, err
	}
	instruments, err := s.repo.ActiveInstruments(ctx, s.db, in.InstrumentIDs)
	if err != nil {
		return nil, err
	}
	if len(instruments) != len(in.InstrumentIDs) {
		return nil, httpx.BadRequest("Ada instrumen yang tidak ditemukan atau nonaktif")
	}
	names := make([]string, len(instruments))
	for i, inst := range instruments {
		names[i] = inst.Name
	}
	var session *Row
	err = s.inTx(ctx, func(tx pgx.Tx) error {
		var err error
		if session, err = s.repo.InsertPsikotesSession(ctx, tx, id, newPortalToken(), in.ExpiresDays, instruments, actor); err != nil {
			return err
		}
		_, err = s.repo.LogActivity(ctx, tx, id, "psikotes_invited",
			fmt.Sprintf("Undangan psikotes online dibuat (%s; berlaku %d hari)", strings.Join(names, ", "), in.ExpiresDays), actor)
		return err
	})
	return session, err
}

// InviteInterview creates an interview AI invitation and its activity.
func (s *Service) InviteInterview(ctx context.Context, id string, in interviewInviteInput, actor Actor) (*Row, error) {
	if _, err := s.requireCandidate(ctx, id); err != nil {
		return nil, err
	}
	var session *Row
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		var err error
		if session, err = s.repo.InsertInterviewSession(ctx, tx, id, newPortalToken(), in, actor); err != nil {
			return err
		}
		_, err = s.repo.LogActivity(ctx, tx, id, "interview_ai_invited",
			fmt.Sprintf("Undangan interview AI dibuat (maks %d pertanyaan; berlaku %d hari)", in.MaxQuestions, in.ExpiresDays), actor)
		return err
	})
	return session, err
}

// numberOrNil is `v ? Number(v) : null` for a numeric (string) column; NaN
// serializes as null like JSON.stringify.
func numberOrNil(v any) any {
	s, ok := v.(string)
	if !ok || s == "" {
		return nil
	}
	f, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return nil
	}
	return json.Number(strconv.FormatFloat(f, 'f', -1, 64))
}

// OfferPanel is the HR offer panel: salary references and every version.
func (s *Service) OfferPanel(ctx context.Context, id, role string) (*Row, error) {
	candidate, offers, expectation, err := s.repo.OfferPanel(ctx, s.db, id)
	if err != nil {
		return nil, err
	}
	if candidate == nil {
		return nil, httpx.NotFound(msgCandidateNotFound)
	}
	var expected any
	if n := candidate.Int("expected_salary"); n != 0 {
		expected = n
	}
	var interview any
	if expectation != nil {
		interview = expectation
	}
	for _, o := range offers {
		o.Set("base_salary", numberOrNil(o.Get("base_salary")))
		if !domain.CanSeePortalToken(role) {
			o.Set("token", nil)
		}
	}
	return object(
		"salary_reference", object(
			"expected_salary", expected,
			"interview_expectation", interview,
			"position_title", candidate.Get("position_title"),
			"salary_min", numberOrNil(candidate.Get("salary_min")),
			"salary_max", numberOrNil(candidate.Get("salary_max")),
		),
		"offers", offers,
	), nil
}

// CreateOffer writes a new offer version (open ones expire) and its activity.
func (s *Service) CreateOffer(ctx context.Context, id string, in offerInput, actor Actor) (*Row, error) {
	title, found, err := s.repo.CandidatePositionTitle(ctx, s.db, id)
	if err != nil {
		return nil, err
	}
	if !found {
		return nil, httpx.NotFound(msgCandidateNotFound)
	}
	var offer *Row
	err = s.inTx(ctx, func(tx pgx.Tx) error {
		row, version, err := s.repo.CreateOffer(ctx, tx, id, newPortalToken(), title, in, actor)
		if err != nil {
			return err
		}
		offer = row
		_, err = s.repo.LogActivity(ctx, tx, id, "offer_sent",
			fmt.Sprintf("Offer v%d dibuat (berlaku %d hari)", version, in.ExpiresDays), actor)
		return err
	})
	return offer, err
}
