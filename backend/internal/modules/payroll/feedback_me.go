package payroll

import (
	"context"
	"net/http"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/validate"
)

// ESS side of 360 feedback: the signed-in employee fills the reviews
// assigned to them as reviewer, in active cycles only. The admin routes in
// the other feedback files need the KPI admin menus; these need a session
// linked to an employee. Summaries follow from the triggers on responses
// and assignment status (delta 20261101100000_hris_feedback_360.sql).

const myFeedbackSelect = `SELECT x.id, x.status, x.relationship_type, x.due_date, x.submitted_at,
	x.rejection_reason, x.manager_comments, x.employee_id AS employee,
	(SELECT row_to_json(e) FROM (SELECT id, name, period_label, end_date, is_anonymous
	   FROM performance.feedback_cycles WHERE id = x.cycle_id) e) AS cycle,
	(SELECT count(*)::int FROM performance.feedback_responses r WHERE r.assignment_id = x.id) AS answered
	FROM performance.feedback_assignments x JOIN performance.feedback_cycles c ON c.id = x.cycle_id
	WHERE x.reviewer_id = $1 AND c.status = 'active'`

const activeCriteriaSQL = `SELECT cr.id FROM performance.feedback_criteria cr
	JOIN performance.feedback_categories c ON c.id = cr.category_id
	WHERE cr.is_active AND c.is_active`

var myFeedbackEmployee = []string{"id", "full_name", "department", "position"}

// editableFeedback are the statuses a reviewer may still change: a
// rejected self-assessment goes back to its reviewer.
var editableFeedback = map[string]bool{"pending": true, "in_progress": true, "rejected": true}

// feedbackReviewer is the employee linked to the session ("" when none).
func (h *handler) feedbackReviewer(r *http.Request) (string, error) {
	userID, _, err := h.sessionIdentity(r)
	if err != nil {
		return "", err
	}
	return h.svc.ports.Employees.IDByUser(r.Context(), h.svc.db, userID)
}

// myFeedback loads one assignment of the reviewer, 404 when it is not theirs.
func (h *handler) myFeedback(r *http.Request) (*obj, error) {
	me, err := h.feedbackReviewer(r)
	if err != nil {
		return nil, err
	}
	if me == "" {
		return nil, httpx.Forbidden("Akun ini tidak terhubung ke data karyawan")
	}
	row, err := queryObj(r.Context(), h.svc.db, myFeedbackSelect+` AND x.id::text = $2`, me, r.PathValue("id"))
	if err != nil {
		return nil, err
	}
	if row == nil {
		return nil, httpx.NotFound("Penilaian tidak ditemukan")
	}
	return row, nil
}

// GET /api/hris/me/feedback-360: the reviews assigned to me in active cycles.
func (h *handler) listMyFeedback(w http.ResponseWriter, r *http.Request) error {
	me, err := h.feedbackReviewer(r)
	if err != nil {
		return err
	}
	ctx := r.Context()
	rows := []*obj{}
	if me != "" {
		if rows, err = queryObjs(ctx, h.svc.db, myFeedbackSelect+` ORDER BY x.due_date ASC NULLS LAST, x.created_at ASC`, me); err != nil {
			return err
		}
		if err := h.svc.stitch(ctx, h.svc.db, rows, embed{"employee", "employee", myFeedbackEmployee}); err != nil {
			return err
		}
	}
	var total int
	if err := h.svc.db.QueryRow(ctx, `SELECT count(*)::int FROM (`+activeCriteriaSQL+`) a`).Scan(&total); err != nil {
		return err
	}
	return writeJSON(w, struct {
		Data          []*obj `json:"data"`
		CriteriaTotal int    `json:"criteria_total"`
	}{rows, total})
}

// GET /api/hris/me/feedback-360/{id}: the form, with the active categories,
// their criteria and my answers so far.
func (h *handler) getMyFeedback(w http.ResponseWriter, r *http.Request) error {
	row, err := h.myFeedback(r)
	if err != nil {
		return err
	}
	ctx := r.Context()
	if err := h.svc.stitch(ctx, h.svc.db, []*obj{row}, embed{"employee", "employee", myFeedbackEmployee}); err != nil {
		return err
	}
	categories, err := queryObjs(ctx, h.svc.db, `SELECT c.id, c.name, c.description, c.weight,
		COALESCE((SELECT json_agg(e ORDER BY e.display_order, e.name) FROM (
		   SELECT id, name, description, display_order FROM performance.feedback_criteria
		    WHERE category_id = c.id AND is_active) e), '[]'::json) AS criteria
		FROM performance.feedback_categories c WHERE c.is_active ORDER BY c.display_order, c.name`)
	if err != nil {
		return err
	}
	responses, err := queryObjs(ctx, h.svc.db, `SELECT criteria_id, rating, comments
		FROM performance.feedback_responses WHERE assignment_id = $1`, row.Get("id"))
	if err != nil {
		return err
	}
	status, _ := row.Get("status").(string)
	row.Set("editable", editableFeedback[status])
	row.Set("categories", categories)
	row.Set("responses", responses)
	return writeJSON(w, dataBody{row})
}

type feedbackAnswer struct {
	criteria string
	rating   int
	comments *string
}

// PUT /api/hris/me/feedback-360/{id} { responses: [{ criteria_id, rating, comments? }], submit? }:
// save my answers; submit also needs every active criterion answered.
func (h *handler) saveMyFeedback(w http.ResponseWriter, r *http.Request) error {
	const msg = "Data tidak valid"
	f, err := readJSON(r, msg)
	if err != nil {
		return err
	}
	var answers []feedbackAnswer
	f.List("responses", validate.Rule{}, 500, func(sub *validate.Form, i int, v any) {
		it := sub.Item(i, v)
		a := feedbackAnswer{}
		if s := it.UUID("criteria_id", validate.Rule{}); s != nil {
			a.criteria = *s
		}
		if n := it.Int("rating", validate.Rule{}, validate.NumOpts{Min: validate.Bound(1), Max: validate.Bound(5)}); n != nil {
			a.rating = *n
		}
		a.comments = orNil(it.Str("comments", nullish, validate.StrOpts{Trim: true, Max: 5000}))
		answers = append(answers, a)
	})
	submit := f.BoolDefault("submit", false)
	if err := issuesErr(f, msg); err != nil {
		return err
	}
	row, err := h.myFeedback(r)
	if err != nil {
		return err
	}
	if status, _ := row.Get("status").(string); !editableFeedback[status] {
		return httpx.Conflict("Penilaian ini sudah dikirim dan tidak bisa diubah")
	}
	id, _ := row.Get("id").(string)
	var status string
	err = database.WithTx(r.Context(), h.svc.db, func(tx pgx.Tx) error {
		var e error
		status, e = h.svc.saveFeedbackAnswers(r.Context(), tx, id, answers, submit)
		return e
	})
	if err != nil {
		return err
	}
	message := "Draf penilaian tersimpan"
	if status == "submitted" {
		message = "Penilaian terkirim"
	}
	return writeJSON(w, struct {
		Data    map[string]string `json:"data"`
		Message string            `json:"message"`
	}{map[string]string{"id": id, "status": status}, message})
}

// saveFeedbackAnswers upserts the answers and moves the assignment to
// in_progress, or to submitted when asked and every active criterion has an
// answer. It returns the new status.
func (s *service) saveFeedbackAnswers(ctx context.Context, tx pgx.Tx, id string, answers []feedbackAnswer, submit bool) (string, error) {
	active := map[string]bool{}
	rows, err := tx.Query(ctx, activeCriteriaSQL)
	if err != nil {
		return "", err
	}
	ids, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return "", err
	}
	for _, c := range ids {
		active[c] = true
	}
	for _, a := range answers {
		if !active[a.criteria] {
			return "", httpx.BadRequest("Kriteria penilaian tidak dikenal")
		}
		if _, err := tx.Exec(ctx, `INSERT INTO performance.feedback_responses (assignment_id, criteria_id, rating, comments)
			VALUES ($1, $2, $3, $4)
			ON CONFLICT (assignment_id, criteria_id) DO UPDATE SET rating = EXCLUDED.rating, comments = EXCLUDED.comments, updated_at = now()`,
			id, a.criteria, a.rating, a.comments); err != nil {
			return "", err
		}
	}
	var answered int
	if err := tx.QueryRow(ctx, `SELECT count(*)::int FROM performance.feedback_responses
		WHERE assignment_id = $1 AND criteria_id IN (`+activeCriteriaSQL+`)`, id).Scan(&answered); err != nil {
		return "", err
	}
	if !submit {
		_, err := tx.Exec(ctx, `UPDATE performance.feedback_assignments
			SET status = 'in_progress', started_at = COALESCE(started_at, $2) WHERE id = $1`, id, s.nowISO())
		return "in_progress", err
	}
	if len(active) == 0 || answered < len(active) {
		return "", httpx.BadRequest("Lengkapi penilaian semua kriteria sebelum mengirim")
	}
	_, err = tx.Exec(ctx, `UPDATE performance.feedback_assignments
		SET status = 'submitted', started_at = COALESCE(started_at, $2), submitted_at = $2, rejection_reason = NULL
		WHERE id = $1`, id, s.nowISO())
	return "submitted", err
}
