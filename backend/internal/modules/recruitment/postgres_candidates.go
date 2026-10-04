package recruitment

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"nuhabit/backend/internal/modules/recruitment/domain"
	"nuhabit/backend/internal/platform/database"
)

// Postgres is the recruitment store: SQL ported from the TS routes and
// lib/recruitment. Methods take the Querier so they run on the pool or
// inside a use case's transaction. hris.positions and item.brands are joined
// read-only for display fields, as the TS queries do.
type Postgres struct{}

// selectWithRefs is SELECT_WITH_REFS: candidate columns plus the nested
// brands {name} / positions {title} of the old PostgREST shape.
const selectWithRefs = `
  c.*,
  CASE WHEN b.id IS NULL THEN NULL ELSE json_build_object('name', b.name) END AS brands,
  CASE WHEN p.id IS NULL THEN NULL ELSE json_build_object('title', p.title) END AS positions
  FROM recruitment.candidates c
  LEFT JOIN item.brands b ON b.id = c.brand_id
  LEFT JOIN hris.positions p ON p.id = c.position_id`

// candidateListWhere is buildCandidateListWhere.
func candidateListWhere(q candidateListQuery) (string, []any) {
	var clauses []string
	var params []any
	add := func(sql func(n string) string, v any) {
		params = append(params, v)
		clauses = append(clauses, sql(fmt.Sprintf("$%d", len(params))))
	}
	if q.Status != nil {
		add(func(n string) string { return "c.status = " + n }, *q.Status)
	}
	if q.BrandID != nil {
		add(func(n string) string { return "c.brand_id = " + n }, *q.BrandID)
	}
	if q.PositionID != nil {
		add(func(n string) string { return "c.position_id = " + n }, *q.PositionID)
	}
	// session time zone is Asia/Jakarta, so date bounds follow the WIB day
	if q.DateFrom != nil {
		add(func(n string) string { return "c.created_at >= " + n + "::date" }, *q.DateFrom)
	}
	if q.DateTo != nil {
		add(func(n string) string { return "c.created_at < " + n + "::date + 1" }, *q.DateTo)
	}
	if q.Search != nil {
		add(func(n string) string {
			return "(c.full_name ILIKE " + n + " OR c.email ILIKE " + n + " OR c.phone ILIKE " + n + ")"
		}, domain.LikePattern(*q.Search))
	}
	if len(clauses) == 0 {
		return "", params
	}
	return "WHERE " + strings.Join(clauses, " AND "), params
}

// ListCandidates is listCandidates: every row when all, else one page and
// the total.
func (Postgres) ListCandidates(ctx context.Context, db database.Querier, q candidateListQuery) ([]*Row, int, error) {
	where, params := candidateListWhere(q)
	order := "ORDER BY c.created_at DESC"
	if q.Sort == "updated_at" {
		order = "ORDER BY c.updated_at DESC"
	}
	if q.All {
		rows, err := collect(db.Query(ctx, "SELECT "+selectWithRefs+" "+where+" "+order, params...))
		return rows, len(rows), err
	}
	n := len(params)
	rows, err := collect(db.Query(ctx,
		fmt.Sprintf("SELECT %s %s %s LIMIT $%d OFFSET $%d", selectWithRefs, where, order, n+1, n+2),
		append(params, q.Limit, (q.Page-1)*q.Limit)...))
	if err != nil {
		return nil, 0, err
	}
	var total int
	err = db.QueryRow(ctx, "SELECT count(*)::int AS total FROM recruitment.candidates c "+where, params...).Scan(&total)
	return rows, total, err
}

// GetCandidate is getCandidate (nil when missing).
func (Postgres) GetCandidate(ctx context.Context, db database.Querier, id string) (*Row, error) {
	return collectOne(db.Query(ctx, "SELECT "+selectWithRefs+" WHERE c.id = $1", id))
}

// CandidateStatus returns the status of a candidate, ok=false when missing.
func (Postgres) CandidateStatus(ctx context.Context, db database.Querier, id string) (string, bool, error) {
	var status string
	err := db.QueryRow(ctx, "SELECT status FROM recruitment.candidates WHERE id = $1", id).Scan(&status)
	if database.IsNoRows(err) {
		return "", false, nil
	}
	return status, err == nil, err
}

// InsertCandidate is createCandidate: the CREATE_COLUMNS plus created_by,
// RETURNING *.
func (Postgres) InsertCandidate(ctx context.Context, db database.Querier, cols []string, vals []any, createdBy string) (*Row, error) {
	vals = append(vals, createdBy)
	ph := make([]string, len(vals))
	for i := range vals {
		ph[i] = fmt.Sprintf("$%d", i+1)
	}
	return collectOne(db.Query(ctx, fmt.Sprintf(`INSERT INTO recruitment.candidates (%s, created_by)
     VALUES (%s) RETURNING *`, strings.Join(cols, ", "), strings.Join(ph, ", ")), vals...))
}

// UpdateCandidate is updateCandidate: only the allowlisted columns sent
// (status never; it moves through /stage). No columns returns the row as is.
func (Postgres) UpdateCandidate(ctx context.Context, db database.Querier, id string, cols []string, vals []any) (*Row, error) {
	if len(cols) == 0 {
		return collectOne(db.Query(ctx, "SELECT * FROM recruitment.candidates WHERE id = $1", id))
	}
	sets := make([]string, len(cols))
	for i, c := range cols {
		sets[i] = fmt.Sprintf("%s = $%d", c, i+2)
	}
	return collectOne(db.Query(ctx,
		"UPDATE recruitment.candidates SET "+strings.Join(sets, ", ")+", updated_at = now() WHERE id = $1 RETURNING *",
		append([]any{id}, vals...)...))
}

// SetCandidateStatus moves a candidate to another stage.
func (Postgres) SetCandidateStatus(ctx context.Context, db database.Querier, id, status string) error {
	_, err := db.Exec(ctx, "UPDATE recruitment.candidates SET status = $1, updated_at = now() WHERE id = $2", status, id)
	return err
}

const activityFields = "id, candidate_id, activity_type, description, created_by, created_by_name, created_at"

// ListActivities is listCandidateActivities.
func (Postgres) ListActivities(ctx context.Context, db database.Querier, id string) ([]*Row, error) {
	return collect(db.Query(ctx, `SELECT `+activityFields+`
       FROM recruitment.candidate_activities
      WHERE candidate_id = $1
      ORDER BY created_at DESC`, id))
}

// LogActivity is logCandidateActivity: the trail entry of a staff action.
func (Postgres) LogActivity(ctx context.Context, db database.Querier, candidateID, activityType, description string, actor Actor) (*Row, error) {
	return collectOne(db.Query(ctx, `INSERT INTO recruitment.candidate_activities
       (candidate_id, activity_type, description, created_by, created_by_name)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING `+activityFields, candidateID, activityType, description, actor.ID, actor.FullName))
}

const noteFields = "id, candidate_id, content, created_by, created_by_name, created_at"

// ListNotes lists a candidate's notes, newest first.
func (Postgres) ListNotes(ctx context.Context, db database.Querier, id string) ([]*Row, error) {
	return collect(db.Query(ctx,
		`SELECT `+noteFields+` FROM recruitment.candidate_notes WHERE candidate_id = $1 ORDER BY created_at DESC`, id))
}

// InsertNote adds an internal HR note.
func (Postgres) InsertNote(ctx context.Context, db database.Querier, id, content string, actor Actor) (*Row, error) {
	return collectOne(db.Query(ctx, `INSERT INTO recruitment.candidate_notes (candidate_id, content, created_by, created_by_name)
       VALUES ($1, $2, $3, $4) RETURNING `+noteFields, id, content, actor.ID, actor.FullName))
}

const screeningFields = `id, candidate_id, contacted, interested, availability_note,
  confirmed_salary::float8 AS confirmed_salary, willing_shift, willing_placement,
  notes, recommendation, updated_by, updated_by_name, created_at, updated_at`

// GetScreening returns the screening call result (nil when none).
func (Postgres) GetScreening(ctx context.Context, db database.Querier, id string) (*Row, error) {
	return collectOne(db.Query(ctx, `SELECT `+screeningFields+` FROM recruitment.candidate_screenings WHERE candidate_id = $1`, id))
}

// UpsertScreening writes the one screening row per candidate.
func (Postgres) UpsertScreening(ctx context.Context, db database.Querier, id string, in screeningInput, actor Actor) (*Row, error) {
	return collectOne(db.Query(ctx, `INSERT INTO recruitment.candidate_screenings
         (candidate_id, contacted, interested, availability_note, confirmed_salary,
          willing_shift, willing_placement, notes, recommendation, updated_by, updated_by_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (candidate_id) DO UPDATE SET
         contacted = EXCLUDED.contacted,
         interested = EXCLUDED.interested,
         availability_note = EXCLUDED.availability_note,
         confirmed_salary = EXCLUDED.confirmed_salary,
         willing_shift = EXCLUDED.willing_shift,
         willing_placement = EXCLUDED.willing_placement,
         notes = EXCLUDED.notes,
         recommendation = EXCLUDED.recommendation,
         updated_by = EXCLUDED.updated_by,
         updated_by_name = EXCLUDED.updated_by_name,
         updated_at = now()
       RETURNING `+screeningFields,
		id, in.Contacted, in.Interested, in.AvailabilityNote, in.ConfirmedSalary,
		in.WillingShift, in.WillingPlacement, in.Notes, in.Recommendation, actor.ID, actor.FullName))
}

const psikotesSummaryFields = `id, candidate_id, recommendation, notes, updated_by, updated_by_name,
                 created_at, updated_at`

// UpsertPsikotesSummary writes the overall psikotes recommendation.
func (Postgres) UpsertPsikotesSummary(ctx context.Context, db database.Querier, id string, in psikotesSummaryInput, actor Actor) (*Row, error) {
	return collectOne(db.Query(ctx, `INSERT INTO recruitment.candidate_psikotes_summary
         (candidate_id, recommendation, notes, updated_by, updated_by_name)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (candidate_id) DO UPDATE SET
         recommendation  = EXCLUDED.recommendation,
         notes           = EXCLUDED.notes,
         updated_by      = EXCLUDED.updated_by,
         updated_by_name = EXCLUDED.updated_by_name,
         updated_at      = now()
       RETURNING `+psikotesSummaryFields, id, in.Recommendation, in.Notes, actor.ID, actor.FullName))
}

// PsikotesPanel loads the HR psikotes panel: summary, sessions (newest
// first), tests with instrument fields, proctoring counts per session/type.
func (Postgres) PsikotesPanel(ctx context.Context, db database.Querier, id string) (summary *Row, sessions, tests []*Row, proctor []proctorCount, err error) {
	if summary, err = collectOne(db.Query(ctx, `SELECT `+psikotesSummaryFields+`
       FROM recruitment.candidate_psikotes_summary WHERE candidate_id = $1`, id)); err != nil {
		return
	}
	if sessions, err = collect(db.Query(ctx, `SELECT id, token, status, webcam_consent, invited_at, expires_at,
              started_at, completed_at, created_by_name, created_at
       FROM recruitment.psikotes_sessions
       WHERE candidate_id = $1
       ORDER BY created_at DESC`, id)); err != nil {
		return
	}
	if tests, err = collect(db.Query(ctx, `SELECT t.id, t.session_id, t.status, t.score, t.score_detail,
              t.attachment_path, t.review_notes, t.reviewed_by_name,
              t.ai_insight, t.sort_order, t.started_at, t.completed_at,
              i.code AS instrument_code, i.name AS instrument_name,
              i.kind AS instrument_kind
       FROM recruitment.psikotes_session_tests t
       JOIN recruitment.psikotes_instruments i ON i.id = t.instrument_id
       JOIN recruitment.psikotes_sessions s ON s.id = t.session_id
       WHERE s.candidate_id = $1
       ORDER BY s.created_at DESC, t.sort_order`, id)); err != nil {
		return
	}
	proctor, err = proctorCounts(ctx, db, "recruitment.psikotes_proctor_events", "recruitment.psikotes_sessions", id)
	return
}

// InterviewPanel loads the HR interview panel: sessions, turns, proctoring.
func (Postgres) InterviewPanel(ctx context.Context, db database.Querier, id string) (sessions, turns []*Row, proctor []proctorCount, err error) {
	if sessions, err = collect(db.Query(ctx, `SELECT id, token, status, webcam_consent, config, ai_summary, summary_model,
              summarized_at, invited_at, expires_at, started_at, completed_at,
              created_by_name, created_at
       FROM recruitment.interview_ai_sessions
       WHERE candidate_id = $1
       ORDER BY created_at DESC`, id)); err != nil {
		return
	}
	if turns, err = collect(db.Query(ctx, `SELECT t.id, t.session_id, t.turn_no, t.topic, t.question,
              t.answer_transcript, t.answer_mode, t.answer_audio_path,
              t.asked_at, t.answered_at
       FROM recruitment.interview_ai_turns t
       JOIN recruitment.interview_ai_sessions s ON s.id = t.session_id
       WHERE s.candidate_id = $1
       ORDER BY s.created_at DESC, t.turn_no`, id)); err != nil {
		return
	}
	proctor, err = proctorCounts(ctx, db, "recruitment.interview_ai_proctor_events", "recruitment.interview_ai_sessions", id)
	return
}

type proctorCount struct {
	SessionID, EventType string
	N                    int
}

func proctorCounts(ctx context.Context, db database.Querier, events, sessions, candidateID string) ([]proctorCount, error) {
	rows, err := db.Query(ctx, `SELECT e.session_id::text, e.event_type, count(*)::int AS n
       FROM `+events+` e
       JOIN `+sessions+` s ON s.id = e.session_id
       WHERE s.candidate_id = $1
       GROUP BY e.session_id, e.event_type`, candidateID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []proctorCount
	for rows.Next() {
		var c proctorCount
		if err := rows.Scan(&c.SessionID, &c.EventType, &c.N); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// ActiveInstruments returns the active instruments among ids, by sort order.
func (Postgres) ActiveInstruments(ctx context.Context, db database.Querier, ids []string) ([]instrumentRef, error) {
	rows, err := db.Query(ctx, `SELECT id::text, name FROM recruitment.psikotes_instruments
     WHERE id = ANY($1::uuid[]) AND is_active = true
     ORDER BY sort_order`, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []instrumentRef
	for rows.Next() {
		var i instrumentRef
		if err := rows.Scan(&i.ID, &i.Name); err != nil {
			return nil, err
		}
		out = append(out, i)
	}
	return out, rows.Err()
}

type instrumentRef struct{ ID, Name string }

// InsertPsikotesSession creates a 'sent' session with one test per
// instrument in order.
func (Postgres) InsertPsikotesSession(ctx context.Context, db database.Querier, candidateID, token string, expiresDays int, instruments []instrumentRef, actor Actor) (*Row, error) {
	session, err := collectOne(db.Query(ctx, `INSERT INTO recruitment.psikotes_sessions
         (candidate_id, token, status, invited_at, expires_at, created_by, created_by_name)
       VALUES ($1, $2, 'sent', now(), now() + make_interval(days => $3), $4, $5)
       RETURNING id, token, status, invited_at, expires_at`, candidateID, token, expiresDays, actor.ID, actor.FullName))
	if err != nil {
		return nil, err
	}
	for i, inst := range instruments {
		if _, err := db.Exec(ctx, `INSERT INTO recruitment.psikotes_session_tests (session_id, instrument_id, sort_order)
         VALUES ($1, $2, $3)`, session.Str("id"), inst.ID, i); err != nil {
			return nil, err
		}
	}
	return session, nil
}

// InsertInterviewSession creates a 'sent' interview AI invitation.
func (Postgres) InsertInterviewSession(ctx context.Context, db database.Querier, candidateID, token string, in interviewInviteInput, actor Actor) (*Row, error) {
	config, _ := json.Marshal(map[string]int{"max_questions": in.MaxQuestions})
	return collectOne(db.Query(ctx, `INSERT INTO recruitment.interview_ai_sessions
         (candidate_id, token, status, config, invited_at, expires_at, created_by, created_by_name)
       VALUES ($1, $2, 'sent', $3, now(), now() + make_interval(days => $4), $5, $6)
       RETURNING id, token, status, invited_at, expires_at`,
		candidateID, token, string(config), in.ExpiresDays, actor.ID, actor.FullName))
}
