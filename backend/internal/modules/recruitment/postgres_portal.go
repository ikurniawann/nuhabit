package recruitment

import (
	"context"
	"encoding/json"
	"fmt"

	"nuhabit/backend/internal/platform/database"
)

// Live session tables by type (LIVE_SESSION_TABLE and EVENT_TABLE).
var (
	liveSessionTable = map[string]string{
		"psikotes":  "recruitment.psikotes_sessions",
		"interview": "recruitment.interview_ai_sessions",
	}
	proctorEventTable = map[string]string{
		"psikotes":  "recruitment.psikotes_proctor_events",
		"interview": "recruitment.interview_ai_proctor_events",
	}
)

// PsikotesSessionByToken loads a portal psikotes session with the
// candidate name and position title.
func (Postgres) PsikotesSessionByToken(ctx context.Context, db database.Querier, token string) (*Row, error) {
	return collectOne(db.Query(ctx, `SELECT s.id, s.candidate_id, s.token, s.status, s.webcam_consent,
            s.invited_at, s.expires_at, s.started_at, s.completed_at,
            c.full_name AS candidate_name, p.title AS position_title
     FROM recruitment.psikotes_sessions s
     JOIN recruitment.candidates c ON c.id = s.candidate_id
     LEFT JOIN hris.positions p ON p.id = c.position_id
     WHERE s.token = $1`, token))
}

// InterviewSessionByToken loads a portal interview session.
func (Postgres) InterviewSessionByToken(ctx context.Context, db database.Querier, token string) (*Row, error) {
	return collectOne(db.Query(ctx, `SELECT s.id, s.candidate_id, s.token, s.status, s.webcam_consent, s.config,
            s.ai_summary, s.invited_at, s.expires_at, s.started_at, s.completed_at,
            c.full_name AS candidate_name, p.title AS position_title
     FROM recruitment.interview_ai_sessions s
     JOIN recruitment.candidates c ON c.id = s.candidate_id
     LEFT JOIN hris.positions p ON p.id = c.position_id
     WHERE s.token = $1`, token))
}

// ExpireSession marks a lapsed portal session expired.
func (Postgres) ExpireSession(ctx context.Context, db database.Querier, sessionType, id string) error {
	_, err := db.Exec(ctx, `UPDATE `+liveSessionTable[sessionType]+` SET status = 'expired' WHERE id = $1`, id)
	return err
}

const sessionTestSelect = `SELECT t.id, t.session_id, t.instrument_id, t.status, t.answers,
            t.attachment_path, t.sort_order, t.started_at, t.completed_at,
            i.code AS instrument_code, i.name AS instrument_name,
            i.kind AS instrument_kind, i.config AS instrument_config
     FROM recruitment.psikotes_session_tests t
     JOIN recruitment.psikotes_instruments i ON i.id = t.instrument_id`

// SessionTests lists a session's tests for the portal.
func (Postgres) SessionTests(ctx context.Context, db database.Querier, sessionID string) ([]*Row, error) {
	return collect(db.Query(ctx, sessionTestSelect+`
     WHERE t.session_id = $1
     ORDER BY t.sort_order, i.sort_order`, sessionID))
}

// SessionTest loads one test of a session (nil when missing).
func (Postgres) SessionTest(ctx context.Context, db database.Querier, sessionID, testID string) (*Row, error) {
	return collectOne(db.Query(ctx, sessionTestSelect+`
     WHERE t.id = $1 AND t.session_id = $2`, testID, sessionID))
}

// StartPsikotesSession moves a session to in_progress with the consent.
func (Postgres) StartPsikotesSession(ctx context.Context, db database.Querier, id string, consent bool) (*Row, error) {
	return collectOne(db.Query(ctx, `UPDATE recruitment.psikotes_sessions SET
       status = 'in_progress',
       webcam_consent = $2,
       started_at = COALESCE(started_at, now())
     WHERE id = $1
     RETURNING id, status, webcam_consent, started_at`, id, consent))
}

// DrawQuestionIDs picks a test's question ids: random order for shuffled
// MCQ, else bank order; limit 0 means all.
func (Postgres) DrawQuestionIDs(ctx context.Context, db database.Querier, instrumentID string, shuffle bool, limit int) ([]string, error) {
	order := "sort_order, created_at"
	if shuffle {
		order = "random()"
	}
	sql := `SELECT id::text FROM recruitment.psikotes_questions
     WHERE instrument_id = $1 AND is_active = true
     ORDER BY ` + order
	args := []any{instrumentID}
	if limit > 0 {
		sql += "\n     LIMIT $2"
		args = append(args, limit)
	}
	return queryStrings(ctx, db, sql, args...)
}

func queryStrings(ctx context.Context, db database.Querier, sql string, args ...any) ([]string, error) {
	rows, err := db.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var s string
		if err := rows.Scan(&s); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// BeginTest stores the drawn questions once; a racing start loses quietly.
func (Postgres) BeginTest(ctx context.Context, db database.Querier, testID string, questionIDs []string) error {
	answers, _ := json.Marshal(map[string]any{"question_ids": questionIDs, "answers": map[string]string{}})
	_, err := db.Exec(ctx, `UPDATE recruitment.psikotes_session_tests SET
         status = 'in_progress',
         started_at = COALESCE(started_at, now()),
         answers = $2::jsonb
       WHERE id = $1 AND status = 'pending'`, testID, string(answers))
	return err
}

// QuestionsByID loads questions by id with the given columns.
func (Postgres) QuestionsByID(ctx context.Context, db database.Querier, columns string, ids []string) ([]*Row, error) {
	return collect(db.Query(ctx, `SELECT `+columns+` FROM recruitment.psikotes_questions WHERE id = ANY($1::uuid[])`, ids))
}

// MergeAnswers merges autosaved answers while the test runs and returns the
// stored answers object (nil when the test is no longer running).
func (Postgres) MergeAnswers(ctx context.Context, db database.Querier, testID string, answers map[string]string) (json.RawMessage, error) {
	raw, _ := json.Marshal(answers)
	row, err := collectOne(db.Query(ctx, `UPDATE recruitment.psikotes_session_tests SET
       answers = jsonb_set(answers, '{answers}', COALESCE(answers->'answers', '{}'::jsonb) || $2::jsonb)
     WHERE id = $1 AND status = 'in_progress'
     RETURNING answers`, testID, string(raw)))
	if err != nil || row == nil {
		return nil, err
	}
	v, _ := row.Get("answers").(json.RawMessage)
	if v == nil {
		v = json.RawMessage("null")
	}
	return v, nil
}

// FinishDrawingTest queues a drawing test for HR review.
func (Postgres) FinishDrawingTest(ctx context.Context, db database.Querier, testID string) (*Row, error) {
	return collectOne(db.Query(ctx, `UPDATE recruitment.psikotes_session_tests SET
         status = 'perlu_review', completed_at = now()
       WHERE id = $1 AND status = 'in_progress'
       RETURNING id, status, completed_at`, testID))
}

// ScoreTest stores the final answers and the score once.
func (Postgres) ScoreTest(ctx context.Context, db database.Querier, testID string, answers map[string]string, score *int, detail any) (*Row, error) {
	rawAnswers, _ := json.Marshal(answers)
	rawDetail, _ := json.Marshal(detail)
	return collectOne(db.Query(ctx, `UPDATE recruitment.psikotes_session_tests SET
       status = 'selesai',
       answers = jsonb_set(answers, '{answers}', $2::jsonb),
       score = $3,
       score_detail = $4::jsonb,
       completed_at = now()
     WHERE id = $1 AND status = 'in_progress'
     RETURNING id, status, score, completed_at`, testID, string(rawAnswers), score, string(rawDetail)))
}

// UnfinishedTestNames lists the instruments a session still has open.
func (Postgres) UnfinishedTestNames(ctx context.Context, db database.Querier, sessionID string) ([]string, error) {
	return queryStrings(ctx, db, `SELECT i.name FROM recruitment.psikotes_session_tests t
     JOIN recruitment.psikotes_instruments i ON i.id = t.instrument_id
     WHERE t.session_id = $1 AND t.status IN ('pending', 'in_progress')`, sessionID)
}

// CompletePsikotesSession closes a running session (nil when another
// request won the transition).
func (Postgres) CompletePsikotesSession(ctx context.Context, db database.Querier, id string) (*Row, error) {
	return collectOne(db.Query(ctx, `UPDATE recruitment.psikotes_sessions SET
         status = 'completed', completed_at = now()
       WHERE id = $1 AND status = 'in_progress'
       RETURNING id, status, completed_at`, id))
}

// LogSystemActivity writes an activity attributed to "Sistem".
func (Postgres) LogSystemActivity(ctx context.Context, db database.Querier, candidateID, activityType, description string) error {
	_, err := db.Exec(ctx, `INSERT INTO recruitment.candidate_activities
         (candidate_id, activity_type, description, created_by, created_by_name)
       VALUES ($1, $2, $3, NULL, 'Sistem')`, candidateID, activityType, description)
	return err
}

// LogAnonymousActivity writes an activity without attribution (portal flows).
func (Postgres) LogAnonymousActivity(ctx context.Context, db database.Querier, candidateID, activityType, description string) error {
	_, err := db.Exec(ctx, `INSERT INTO recruitment.candidate_activities (candidate_id, activity_type, description)
       VALUES ($1, $2, $3)`, candidateID, activityType, description)
	return err
}

// ── live monitoring ─────────────────────────────────────────────────────────

// SaveFrame upserts the latest webcam frame of a session.
func (Postgres) SaveFrame(ctx context.Context, db database.Querier, sessionType, sessionID, frameBase64 string) error {
	_, err := db.Exec(ctx, `INSERT INTO recruitment.live_monitor_frames (session_type, session_id, frame_base64, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (session_type, session_id)
     DO UPDATE SET frame_base64 = EXCLUDED.frame_base64, updated_at = now()`, sessionType, sessionID, frameBase64)
	return err
}

const chatLimit = 100

// ChatMessages lists a session's chat (after a timestamp, or the latest 100
// oldest first).
func (Postgres) ChatMessages(ctx context.Context, db database.Querier, sessionType, sessionID string, after string) ([]*Row, error) {
	if after != "" {
		return collect(db.Query(ctx, fmt.Sprintf(`SELECT id, sender, sender_name, message, created_at
       FROM recruitment.live_chat_messages
       WHERE session_type = $1 AND session_id = $2 AND created_at > $3
       ORDER BY created_at
       LIMIT %d`, chatLimit), sessionType, sessionID, after))
	}
	rows, err := collect(db.Query(ctx, fmt.Sprintf(`SELECT id, sender, sender_name, message, created_at
     FROM recruitment.live_chat_messages
     WHERE session_type = $1 AND session_id = $2
     ORDER BY created_at DESC
     LIMIT %d`, chatLimit), sessionType, sessionID))
	for i, j := 0, len(rows)-1; i < j; i, j = i+1, j-1 {
		rows[i], rows[j] = rows[j], rows[i]
	}
	return rows, err
}

// InsertChat stores a chat message.
func (Postgres) InsertChat(ctx context.Context, db database.Querier, sessionType, sessionID, sender string, senderName *string, message string) (*Row, error) {
	return collectOne(db.Query(ctx, `INSERT INTO recruitment.live_chat_messages
       (session_type, session_id, sender, sender_name, message)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, sender, sender_name, message, created_at`, sessionType, sessionID, sender, senderName, message))
}

// LiveSession loads a session for the HR panel (nil when missing).
func (Postgres) LiveSession(ctx context.Context, db database.Querier, sessionType, id string) (*Row, error) {
	return collectOne(db.Query(ctx, `SELECT s.id, s.status, c.full_name AS candidate_name
     FROM `+liveSessionTable[sessionType]+` s JOIN recruitment.candidates c ON c.id = s.candidate_id
     WHERE s.id = $1`, id))
}

// SessionExists reports whether a session of the type exists, optionally
// only when running.
func (Postgres) SessionExists(ctx context.Context, db database.Querier, sessionType, id string, running bool) (bool, error) {
	sql := `SELECT EXISTS (SELECT 1 FROM ` + liveSessionTable[sessionType] + ` WHERE id = $1`
	if running {
		sql += ` AND status = 'in_progress'`
	}
	var ok bool
	err := db.QueryRow(ctx, sql+`)`, id).Scan(&ok)
	return ok, err
}

// LatestFrame returns a session's last frame and when it arrived.
func (Postgres) LatestFrame(ctx context.Context, db database.Querier, sessionType, id string) (*Row, error) {
	return collectOne(db.Query(ctx, `SELECT frame_base64, updated_at FROM recruitment.live_monitor_frames
     WHERE session_type = $1 AND session_id = $2`, sessionType, id))
}

func onlineSessionsSQL(t string) string {
	return `SELECT '` + t + `' AS session_type, s.id AS session_id, s.started_at,
            c.full_name AS candidate_name, p.title AS position_title,
            f.updated_at AS frame_updated_at,
            lc.created_at AS last_message_at, lc.sender AS last_message_sender
     FROM ` + liveSessionTable[t] + ` s
     JOIN recruitment.candidates c ON c.id = s.candidate_id
     LEFT JOIN hris.positions p ON p.id = c.position_id
     LEFT JOIN recruitment.live_monitor_frames f
       ON f.session_type = '` + t + `' AND f.session_id = s.id
     LEFT JOIN LATERAL (
       SELECT m.created_at, m.sender FROM recruitment.live_chat_messages m
       WHERE m.session_type = '` + t + `' AND m.session_id = s.id
       ORDER BY m.created_at DESC LIMIT 1
     ) lc ON true
     WHERE s.status IN ('sent', 'in_progress')
       AND (f.updated_at > now() - interval '60 seconds'
            OR (lc.sender = 'candidate' AND lc.created_at > now() - interval '10 minutes'))`
}

// OnlineSessions lists running sessions that sent a frame in the last
// minute or a candidate chat in the last ten.
func (Postgres) OnlineSessions(ctx context.Context, db database.Querier) ([]*Row, error) {
	return collect(db.Query(ctx, onlineSessionsSQL("psikotes")+`

     UNION ALL

     `+onlineSessionsSQL("interview")+`

     ORDER BY started_at DESC NULLS LAST`))
}

// ProctorEvents lists a session's proctoring evidence; found is false when
// the session does not exist.
func (p Postgres) ProctorEvents(ctx context.Context, db database.Querier, sessionType, id string) ([]*Row, bool, error) {
	ok, err := p.SessionExists(ctx, db, sessionType, id, false)
	if err != nil || !ok {
		return nil, false, err
	}
	rows, err := collect(db.Query(ctx, `SELECT id, event_type, meta, storage_path, created_at
     FROM `+proctorEventTable[sessionType]+`
     WHERE session_id = $1
     ORDER BY created_at
     LIMIT 1000`, id))
	return rows, true, err
}
