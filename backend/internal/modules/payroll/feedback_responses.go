package payroll

import (
	"net/http"

	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/validate"
)

const responseListSelect = `SELECT x.*,
	(SELECT json_build_object('id', a.id, 'employee', a.employee_id, 'reviewer', a.reviewer_id, 'relationship_type', a.relationship_type)
	   FROM performance.feedback_assignments a WHERE a.id = x.assignment_id) AS assignment,
	(SELECT row_to_json(e) FROM (SELECT c.id, c.name, c.description,
	   (SELECT row_to_json(e2) FROM (SELECT id, name, weight FROM performance.feedback_categories WHERE id = c.category_id) e2) AS category
	   FROM performance.feedback_criteria c WHERE c.id = x.criteria_id) e) AS criteria
	FROM performance.feedback_responses x`

// GET /api/hris/feedback-responses
func (h *handler) listResponses(w http.ResponseWriter, r *http.Request) error {
	if err := h.requireFeedbackAdmin(r); err != nil {
		return err
	}
	p := parsePagination(r, 100)
	var wh where
	for _, key := range []string{"assignment_id", "criteria_id"} {
		if v := r.URL.Query().Get(key); v != "" {
			wh.eq("x."+key, v)
		}
	}
	rows, total, err := h.svc.page(r.Context(), "performance.feedback_responses", responseListSelect, wh, "x.created_at DESC", p)
	if err != nil {
		return err
	}
	assignments := nested(rows, "assignment")
	if err := h.svc.stitchKeys(r.Context(),
		keySpec{assignments, "employee", []string{"id", "full_name"}},
		keySpec{assignments, "reviewer", []string{"id", "full_name"}}); err != nil {
		return err
	}
	return writeJSON(w, pageBody{rows, p.meta(total)})
}

// POST /api/hris/feedback-responses (one object or an array). One answer
// that completes every criterion marks the assignment submitted.
func (h *handler) createResponses(w http.ResponseWriter, r *http.Request) error {
	if err := h.requireFeedbackAdmin(r); err != nil {
		return err
	}
	sets, many, err := oneOrMany(r, func(f *validate.Form) colSet { return parseResponse(f, false) })
	if err != nil {
		return err
	}
	if _, _, err := h.sessionIdentity(r); err != nil {
		return err
	}
	ctx := r.Context()
	rows, err := h.svc.insertRows(ctx, "performance.feedback_responses", sets)
	if err != nil {
		return err
	}
	if !many {
		var assignment string
		for _, c := range sets[0].cols {
			if c.name == "assignment_id" {
				assignment, _ = c.value.(string)
			}
		}
		var criteria, answered int
		if err := h.svc.db.QueryRow(ctx, `SELECT count(*)::int FROM performance.feedback_criteria`).Scan(&criteria); err == nil {
			if err := h.svc.db.QueryRow(ctx, `SELECT count(*)::int FROM performance.feedback_responses WHERE assignment_id = $1`, assignment).Scan(&answered); err == nil && answered >= criteria {
				if _, err := h.svc.db.Exec(ctx, `UPDATE performance.feedback_assignments SET status = 'submitted', submitted_at = $2 WHERE id = $1`,
					assignment, h.svc.nowISO()); err != nil {
					h.svc.log.ErrorContext(ctx, "feedback: mark submitted failed", "assignment_id", assignment, "error", err)
				}
			}
		}
	}
	return httpx.JSON(w, http.StatusCreated, dataBody{rows})
}

const responseDetailSelect = `SELECT x.*,
	(SELECT json_build_object('id', a.id, 'status', a.status, 'relationship_type', a.relationship_type,
	        'employee', a.employee_id, 'reviewer', a.reviewer_id,
	        'cycle', (SELECT row_to_json(e) FROM (SELECT id, name, period_label FROM performance.feedback_cycles WHERE id = a.cycle_id) e))
	   FROM performance.feedback_assignments a WHERE a.id = x.assignment_id) AS assignment,
	(SELECT row_to_json(e) FROM (SELECT id, name, category_id FROM performance.feedback_criteria WHERE id = x.criteria_id) e) AS criteria
	FROM performance.feedback_responses x WHERE x.id::text = $1`

// GET /api/hris/feedback-responses/{id}
func (h *handler) getResponse(w http.ResponseWriter, r *http.Request) error {
	if err := h.requireFeedbackAdmin(r); err != nil {
		return err
	}
	row, err := queryObj(r.Context(), h.svc.db, responseDetailSelect, r.PathValue("id"))
	if err != nil || row == nil {
		return httpx.NotFound("Response not found")
	}
	assignments := nested([]*obj{row}, "assignment")
	if err := h.svc.stitchKeys(r.Context(),
		keySpec{assignments, "employee", personFields},
		keySpec{assignments, "reviewer", personFields}); err != nil {
		return err
	}
	return writeJSON(w, dataBody{row})
}

// PUT /api/hris/feedback-responses/{id} { rating?, comments? }
func (h *handler) updateResponse(w http.ResponseWriter, r *http.Request) error {
	if err := h.requireFeedbackAdmin(r); err != nil {
		return err
	}
	const msg = "Data tidak valid"
	f, err := readJSON(r, msg)
	if err != nil {
		return err
	}
	set := parseResponse(f, true)
	if err := issuesErr(f, msg); err != nil {
		return err
	}
	if _, _, err := h.sessionIdentity(r); err != nil {
		return err
	}
	set.add("updated_at", h.svc.nowISO())
	row, err := h.svc.updateRow(r.Context(), "performance.feedback_responses", r.PathValue("id"), set.cols)
	if err != nil {
		return err
	}
	return writeJSON(w, dataBody{row})
}

// DELETE /api/hris/feedback-responses/{id}
func (h *handler) deleteResponse(w http.ResponseWriter, r *http.Request) error {
	if err := h.requireFeedbackAdmin(r); err != nil {
		return err
	}
	if _, _, err := h.sessionIdentity(r); err != nil {
		return err
	}
	if _, err := h.svc.db.Exec(r.Context(), `DELETE FROM performance.feedback_responses WHERE id = $1`, r.PathValue("id")); err != nil {
		return err
	}
	return writeJSON(w, struct {
		Success bool `json:"success"`
	}{true})
}

// POST /api/hris/feedback-responses/{id} { manager_comments? }: approve the assignment with this id.
func (h *handler) approveViaResponse(w http.ResponseWriter, r *http.Request) error {
	if err := h.requireFeedbackAdmin(r); err != nil {
		return err
	}
	f, err := readJSON(r, "")
	if err != nil {
		return err
	}
	comments := f.Str("manager_comments", nullish, validate.StrOpts{Max: 5000})
	if err := issuesErr(f, ""); err != nil {
		return err
	}
	approver, err := h.approverID(r, "User not found in employees table")
	if err != nil {
		return err
	}
	row, err := h.svc.decideOne(r.Context(), r.PathValue("id"), decision{approve: true, comments: orNil(comments)}, approver)
	if err != nil {
		return err
	}
	return writeJSON(w, decisionBody{true, row, "Feedback approved successfully"})
}

// PATCH /api/hris/feedback-responses/{id} { rejection_reason }: reject the assignment with this id.
func (h *handler) rejectViaResponse(w http.ResponseWriter, r *http.Request) error {
	if err := h.requireFeedbackAdmin(r); err != nil {
		return err
	}
	f, err := readJSON(r, "")
	if err != nil {
		return err
	}
	reason := rejectionReason(f, false)
	if err := issuesErr(f, ""); err != nil {
		return err
	}
	approver, err := h.approverID(r, "User not found in employees table")
	if err != nil {
		return err
	}
	row, err := h.svc.decideOne(r.Context(), r.PathValue("id"), decision{reason: *reason}, approver)
	if err != nil {
		return err
	}
	return writeJSON(w, decisionBody{true, row, "Feedback rejected. Employee has been notified."})
}
