package gymcare

import (
	"context"
	"encoding/json"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/gymcare/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
)

// Declaration is a stored PAR-Q declaration.
type Declaration struct {
	ID          string             `json:"id"`
	Version     string             `json:"version"`
	Answers     domain.ParqAnswers `json:"answers"`
	HasYes      bool               `json:"has_yes"`
	Details     string             `json:"details"`
	SubmittedAt time.Time          `json:"submitted_at"`
	ExpiresAt   time.Time          `json:"expires_at"`
}

// ParqStatus is the member's questionnaire state.
type ParqStatus struct {
	Version   string                `json:"version"`
	Questions []domain.ParqQuestion `json:"questions"`
	// Due: fill it (again) now; never filled, older version or expired.
	Due  bool         `json:"due"`
	Last *Declaration `json:"last"`
}

func latestDeclaration(ctx context.Context, q database.Querier, customerID string) (*Declaration, error) {
	var d Declaration
	var raw []byte
	err := q.QueryRow(ctx, `SELECT id::text, version, answers, has_yes, details, submitted_at, expires_at
	    FROM gym.health_declarations WHERE customer_id = $1 ORDER BY submitted_at DESC, id LIMIT 1`, customerID).
		Scan(&d.ID, &d.Version, &raw, &d.HasYes, &d.Details, &d.SubmittedAt, &d.ExpiresAt)
	if database.IsNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &d, json.Unmarshal(raw, &d.Answers)
}

func (s *Service) status(last *Declaration) *ParqStatus {
	out := &ParqStatus{Version: domain.ParqVersion, Questions: domain.ParqQuestions, Due: true, Last: last}
	if last != nil {
		out.Due = domain.ParqDue(last.Version, &last.ExpiresAt, s.now())
	}
	return out
}

// MemberParq is the member's own questionnaire state.
func (s *Service) MemberParq(ctx context.Context, customerID string) (*ParqStatus, error) {
	last, err := latestDeclaration(ctx, s.db, customerID)
	if err != nil {
		return nil, err
	}
	return s.status(last), nil
}

// SubmitParq stores a declaration and keeps the member's PAR-Q flag in step:
// a yes opens (or reopens, when the answers changed) the pending review
// flag; all no removes a flag no one reviewed yet. A reviewed restriction
// or doctor's note request stays: the reviewer's decision stands.
func (s *Service) SubmitParq(ctx context.Context, customerID string, answers domain.ParqAnswers, details string) (*ParqStatus, error) {
	details = strings.TrimSpace(details)
	if utf8.RuneCountInString(details) > domain.ParqDetailsMax {
		return nil, httpx.BadRequest("Keterangan maksimal 500 karakter")
	}
	now := s.now()
	raw, _ := json.Marshal(answers)
	err := database.WithTx(ctx, s.db, func(tx pgx.Tx) error {
		var declID string
		if err := tx.QueryRow(ctx, `INSERT INTO gym.health_declarations (customer_id, version, answers, has_yes, details, submitted_at, expires_at)
		    VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id::text`,
			customerID, domain.ParqVersion, raw, answers.HasYes(), details, now, domain.ParqExpiry(now)).Scan(&declID); err != nil {
			return err
		}
		var flagID, note string
		var review *string
		err := tx.QueryRow(ctx, `SELECT id::text, note, review_status FROM gym.member_flags
		    WHERE customer_id = $1 AND source = 'parq' AND removed_at IS NULL FOR UPDATE`, customerID).Scan(&flagID, &note, &review)
		open := err == nil
		if err != nil && !database.IsNoRows(err) {
			return err
		}
		err = nil
		if !answers.HasYes() {
			if open && review != nil && *review == domain.ReviewPending {
				_, err = tx.Exec(ctx, `UPDATE gym.member_flags SET removed_at = $2, updated_at = $2 WHERE id = $1`, flagID, now)
			}
			return err
		}
		next := answers.ReviewNote(details)
		switch {
		case !open:
			_, err = tx.Exec(ctx, `INSERT INTO gym.member_flags (customer_id, type_id, note, source, declaration_id, review_status, created_by_name, created_at, updated_at)
			    SELECT $1, t.id, $2, 'parq', $3, 'pending', 'PAR-Q member', $4, $4 FROM gym.member_flag_types t WHERE t.code = $5`,
				customerID, next, declID, now, domain.ParqTypeCode)
		case note != next:
			_, err = tx.Exec(ctx, `UPDATE gym.member_flags SET note = $2, declaration_id = $3, review_status = 'pending',
			    review_note = '', reviewed_at = NULL, reviewed_by = NULL, reviewed_by_name = '', updated_at = $4 WHERE id = $1`,
				flagID, next, declID, now)
		default:
			_, err = tx.Exec(ctx, `UPDATE gym.member_flags SET declaration_id = $2, updated_at = $3 WHERE id = $1`, flagID, declID, now)
		}
		return err
	})
	if err != nil {
		return nil, err
	}
	return s.MemberParq(ctx, customerID)
}

// StaffParq is the member's latest declaration for a manager or a current
// coach; anyone else gets 404, as if there were none.
func (s *Service) StaffParq(ctx context.Context, v Viewer, customerID string) (*ParqStatus, error) {
	ok, err := s.seesMedical(ctx, s.db, v, customerID)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, httpx.NotFound("Deklarasi kesehatan tidak ditemukan")
	}
	return s.MemberParq(ctx, customerID)
}

// ParqCurrent reports whether the member has a declaration of the current
// version that has not expired at at. gym-scheduling asks it when the rule
// requireParq is on.
func ParqCurrent(ctx context.Context, q database.Querier, customerID string, at time.Time) (bool, error) {
	var ok bool
	err := q.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM gym.health_declarations
	    WHERE customer_id = $1 AND version = $2 AND expires_at > $3)`, customerID, domain.ParqVersion, at).Scan(&ok)
	return ok, err
}
