package recruitment

import (
	"context"
	"encoding/json"

	"nuhabit/backend/internal/platform/database"
)

// ListInstruments lists every instrument with its question counts.
func (Postgres) ListInstruments(ctx context.Context, db database.Querier) ([]*Row, error) {
	return collect(db.Query(ctx, `SELECT i.id, i.code, i.name, i.kind, i.config, i.is_active, i.sort_order,
            i.created_at, i.updated_at,
            count(q.id)::int AS question_count,
            count(q.id) FILTER (WHERE q.is_active)::int AS active_question_count
     FROM recruitment.psikotes_instruments i
     LEFT JOIN recruitment.psikotes_questions q ON q.instrument_id = i.id
     GROUP BY i.id
     ORDER BY i.sort_order, i.name`))
}

// UpdateInstrument patches name/is_active and merges config (jsonb ||);
// code and kind are immutable. nil when missing.
func (Postgres) UpdateInstrument(ctx context.Context, db database.Querier, id string, in instrumentInput) (*Row, error) {
	var config *string
	if in.Config != nil {
		raw, _ := json.Marshal(in.Config)
		s := string(raw)
		config = &s
	}
	return collectOne(db.Query(ctx, `UPDATE recruitment.psikotes_instruments SET
       name      = COALESCE($2, name),
       is_active = COALESCE($3, is_active),
       config    = CASE WHEN $4::jsonb IS NULL THEN config ELSE config || $4::jsonb END
     WHERE id = $1
     RETURNING id, code, name, kind, config, is_active, sort_order, created_at, updated_at`,
		id, in.Name, in.IsActive, config))
}

// InstrumentKind returns an instrument's kind; found is false when missing.
func (Postgres) InstrumentKind(ctx context.Context, db database.Querier, id string) (string, bool, error) {
	var kind string
	err := db.QueryRow(ctx, "SELECT kind FROM recruitment.psikotes_instruments WHERE id = $1", id).Scan(&kind)
	if database.IsNoRows(err) {
		return "", false, nil
	}
	return kind, err == nil, err
}

// QuestionKind returns the instrument kind of a question.
func (Postgres) QuestionKind(ctx context.Context, db database.Querier, id string) (string, bool, error) {
	var kind string
	err := db.QueryRow(ctx, `SELECT i.kind
     FROM recruitment.psikotes_questions q
     JOIN recruitment.psikotes_instruments i ON i.id = q.instrument_id
     WHERE q.id = $1`, id).Scan(&kind)
	if database.IsNoRows(err) {
		return "", false, nil
	}
	return kind, err == nil, err
}

const questionFields = "id, instrument_id, body, options, answer_key, sort_order, is_active, created_at, updated_at"

// ListQuestions lists an instrument's bank, answer keys included (HR only).
func (Postgres) ListQuestions(ctx context.Context, db database.Querier, instrumentID string) ([]*Row, error) {
	return collect(db.Query(ctx, `SELECT `+questionFields+` FROM recruitment.psikotes_questions
     WHERE instrument_id = $1
     ORDER BY sort_order, created_at`, instrumentID))
}

func questionArgs(in questionInput) []any {
	options, _ := json.Marshal(in.Options)
	var key *string
	if in.AnswerKey != nil {
		raw, _ := json.Marshal(in.AnswerKey)
		s := string(raw)
		key = &s
	}
	return []any{in.Body, string(options), key, in.SortOrder, in.IsActive}
}

// InsertQuestion adds a bank question.
func (Postgres) InsertQuestion(ctx context.Context, db database.Querier, instrumentID string, in questionInput) (*Row, error) {
	return collectOne(db.Query(ctx, `INSERT INTO recruitment.psikotes_questions
       (instrument_id, body, options, answer_key, sort_order, is_active)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING `+questionFields, append([]any{instrumentID}, questionArgs(in)...)...))
}

// UpdateQuestion replaces a bank question.
func (Postgres) UpdateQuestion(ctx context.Context, db database.Querier, id string, in questionInput) (*Row, error) {
	return collectOne(db.Query(ctx, `UPDATE recruitment.psikotes_questions SET
       body = $2, options = $3, answer_key = $4, sort_order = $5, is_active = $6
     WHERE id = $1
     RETURNING `+questionFields, append([]any{id}, questionArgs(in)...)...))
}

// DeleteQuestion hard-deletes a question (nil when missing); scores keep
// their snapshot.
func (Postgres) DeleteQuestion(ctx context.Context, db database.Querier, id string) (*Row, error) {
	return collectOne(db.Query(ctx, "DELETE FROM recruitment.psikotes_questions WHERE id = $1 RETURNING id", id))
}

// AnswerDetailTest loads a test for the HR answer breakdown.
func (Postgres) AnswerDetailTest(ctx context.Context, db database.Querier, id string) (*Row, error) {
	return collectOne(db.Query(ctx, `SELECT t.id, t.answers, t.score_detail, t.instrument_id, i.kind AS instrument_kind
     FROM recruitment.psikotes_session_tests t
     JOIN recruitment.psikotes_instruments i ON i.id = t.instrument_id
     WHERE t.id = $1`, id))
}

// ActiveBank lists an instrument's active questions in bank order.
func (Postgres) ActiveBank(ctx context.Context, db database.Querier, instrumentID string) ([]*Row, error) {
	return collect(db.Query(ctx, `SELECT id, body, options FROM recruitment.psikotes_questions
     WHERE instrument_id = $1 AND is_active = true
     ORDER BY sort_order, created_at`, instrumentID))
}

// ReviewTarget loads a test with its candidate and instrument name.
func (Postgres) ReviewTarget(ctx context.Context, db database.Querier, id string) (*Row, error) {
	return collectOne(db.Query(ctx, `SELECT t.id, t.status, s.candidate_id, i.name AS instrument_name
     FROM recruitment.psikotes_session_tests t
     JOIN recruitment.psikotes_sessions s ON s.id = t.session_id
     JOIN recruitment.psikotes_instruments i ON i.id = t.instrument_id
     WHERE t.id = $1`, id))
}

// SaveReview marks a projective test reviewed.
func (Postgres) SaveReview(ctx context.Context, db database.Querier, id, notes string, actor Actor) (*Row, error) {
	return collectOne(db.Query(ctx, `UPDATE recruitment.psikotes_session_tests SET
         status = 'reviewed', review_notes = $2, reviewed_by = $3, reviewed_by_name = $4
       WHERE id = $1
       RETURNING id, status, review_notes, reviewed_by_name`, id, notes, actor.ID, actor.FullName))
}
