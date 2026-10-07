package recruitment

import (
	"context"
	"encoding/json"

	"nuhabit/backend/internal/platform/database"
)

// OfferPanel loads the HR offer panel: the candidate's salary references,
// every offer version, and the salary expectation from the latest completed
// interview AI summary. candidate is nil when the candidate is missing.
func (Postgres) OfferPanel(ctx context.Context, db database.Querier, id string) (candidate *Row, offers []*Row, expectation json.RawMessage, err error) {
	if candidate, err = collectOne(db.Query(ctx, `SELECT c.id, c.expected_salary, p.title AS position_title,
              p.salary_min, p.salary_max
       FROM recruitment.candidates c
       LEFT JOIN hris.positions p ON p.id = c.position_id
       WHERE c.id = $1`, id)); err != nil {
		return
	}
	if offers, err = collect(db.Query(ctx, `SELECT id, version, token, status, position_title, base_salary, benefits,
              start_date, notes, response_note, responded_at, response_source,
              sent_at, expires_at, created_by_name, created_at
       FROM recruitment.candidate_offers
       WHERE candidate_id = $1
       ORDER BY version DESC`, id)); err != nil {
		return
	}
	row, err := collectOne(db.Query(ctx, `SELECT ai_summary -> 'ekspektasi_gaji' AS ekspektasi
       FROM recruitment.interview_ai_sessions
       WHERE candidate_id = $1 AND status = 'completed' AND ai_summary IS NOT NULL
       ORDER BY completed_at DESC LIMIT 1`, id))
	if err == nil && row != nil {
		expectation, _ = row.Get("ekspektasi").(json.RawMessage)
	}
	return
}

// CandidatePositionTitle returns the candidate's position title; found is
// false when the candidate is missing.
func (Postgres) CandidatePositionTitle(ctx context.Context, db database.Querier, id string) (title *string, found bool, err error) {
	err = db.QueryRow(ctx, `SELECT p.title
     FROM recruitment.candidates c
     LEFT JOIN hris.positions p ON p.id = c.position_id
     WHERE c.id = $1`, id).Scan(&title)
	if database.IsNoRows(err) {
		return nil, false, nil
	}
	return title, err == nil, err
}

// CreateOffer expires the open offers and inserts version max+1 as 'sent'.
func (Postgres) CreateOffer(ctx context.Context, db database.Querier, candidateID, token string, positionTitle *string, in offerInput, actor Actor) (*Row, int, error) {
	// a new revision replaces any offer still open
	if _, err := db.Exec(ctx, `UPDATE recruitment.candidate_offers
       SET status = 'expired'
       WHERE candidate_id = $1 AND status IN ('sent', 'negotiating')`, candidateID); err != nil {
		return nil, 0, err
	}
	var version int
	if err := db.QueryRow(ctx, `SELECT COALESCE(MAX(version), 0) + 1 AS next FROM recruitment.candidate_offers
       WHERE candidate_id = $1`, candidateID).Scan(&version); err != nil {
		return nil, 0, err
	}
	benefits, _ := json.Marshal(in.Benefits)
	var notes *string
	if in.Notes != nil && *in.Notes != "" {
		notes = in.Notes
	}
	row, err := collectOne(db.Query(ctx, `INSERT INTO recruitment.candidate_offers
         (candidate_id, version, token, status, position_title, base_salary,
          benefits, start_date, notes, sent_at, expires_at, created_by, created_by_name)
       VALUES ($1, $2, $3, 'sent', $4, $5, $6, $7, $8, now(),
               now() + make_interval(days => $9), $10, $11)
       RETURNING id, version, token, status, sent_at, expires_at`,
		candidateID, version, token, positionTitle, in.BaseSalary, string(benefits), in.StartDate, notes,
		in.ExpiresDays, actor.ID, actor.FullName))
	return row, version, err
}

// offerRef is the slice of an offer the manual response route checks.
type offerRef struct {
	ID, CandidateID, Status string
	Version                 int
}

// GetOfferRef loads an offer by id (nil when missing).
func (Postgres) GetOfferRef(ctx context.Context, db database.Querier, id string) (*offerRef, error) {
	o := offerRef{}
	err := db.QueryRow(ctx, `SELECT id::text, candidate_id::text, version, status FROM recruitment.candidate_offers WHERE id = $1`, id).
		Scan(&o.ID, &o.CandidateID, &o.Version, &o.Status)
	if database.IsNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &o, nil
}

// RecordManualResponse stores a response HR recorded by hand.
func (Postgres) RecordManualResponse(ctx context.Context, db database.Querier, id, status string, note *string) (*Row, error) {
	return collectOne(db.Query(ctx, `UPDATE recruitment.candidate_offers
         SET status = $2, response_note = $3, responded_at = now(), response_source = 'manual'
         WHERE id = $1
         RETURNING id, status, response_note, responded_at`, id, status, note))
}

// OfferByToken loads a portal offer with the candidate and brand names.
func (Postgres) OfferByToken(ctx context.Context, db database.Querier, token string) (*Row, error) {
	return collectOne(db.Query(ctx, `SELECT o.id, o.candidate_id, o.version, o.token, o.status, o.position_title,
            o.base_salary, o.benefits, o.start_date, o.notes, o.response_note,
            o.responded_at, o.sent_at, o.expires_at,
            c.full_name AS candidate_name, b.name AS brand_name
     FROM recruitment.candidate_offers o
     JOIN recruitment.candidates c ON c.id = o.candidate_id
     LEFT JOIN item.brands b ON b.id = c.brand_id
     WHERE o.token = $1`, token))
}

// ExpireOffer marks a lapsed offer expired.
func (Postgres) ExpireOffer(ctx context.Context, db database.Querier, id string) error {
	_, err := db.Exec(ctx, `UPDATE recruitment.candidate_offers SET status = 'expired' WHERE id = $1`, id)
	return err
}

// RespondOffer stores a portal response while the offer is still open
// (nil when it was answered meanwhile).
func (Postgres) RespondOffer(ctx context.Context, db database.Querier, id, status string, note, ip *string) (*Row, error) {
	return collectOne(db.Query(ctx, `UPDATE recruitment.candidate_offers
       SET status = $2, response_note = $3, responded_at = now(),
           response_ip = $4, response_source = 'portal'
       WHERE id = $1 AND status IN ('sent', 'negotiating')
       RETURNING id, status, response_note, responded_at`, id, status, note, ip))
}
