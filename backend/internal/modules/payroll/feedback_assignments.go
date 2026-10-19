package payroll

import (
	"net/http"

	"nuhabit/backend/internal/platform/httpx"
)

const assignmentListSelect = `SELECT x.*,
	(SELECT row_to_json(e) FROM (SELECT id, name, period_label, status FROM performance.feedback_cycles WHERE id = x.cycle_id) e) AS cycle,
	NULL AS employee, NULL AS reviewer
	FROM performance.feedback_assignments x`

// GET /api/hris/feedback-assignments
func (h *handler) listAssignments(w http.ResponseWriter, r *http.Request) error {
	if err := h.requireFeedbackAdmin(r); err != nil {
		return err
	}
	p := parsePagination(r, 50)
	var wh where
	for _, key := range []string{"cycle_id", "employee_id", "reviewer_id", "status", "relationship_type"} {
		if v := r.URL.Query().Get(key); v != "" {
			wh.eq("x."+key, v)
		}
	}
	rows, total, err := h.svc.page(r.Context(), "performance.feedback_assignments", assignmentListSelect, wh, "x.created_at DESC", p)
	if err != nil {
		return err
	}
	if err := h.svc.stitch(r.Context(), h.svc.db, rows,
		embed{"employee", "employee_id", []string{"id", "full_name", "nip", "department", "position"}},
		embed{"reviewer", "reviewer_id", []string{"id", "full_name", "nip"}}); err != nil {
		return err
	}
	return writeJSON(w, pageBody{rows, p.meta(total)})
}

// POST /api/hris/feedback-assignments (one object or an array)
func (h *handler) createAssignments(w http.ResponseWriter, r *http.Request) error {
	if err := h.requireFeedbackAdmin(r); err != nil {
		return err
	}
	sets, _, err := oneOrMany(r, parseAssignment)
	if err != nil {
		return err
	}
	if _, _, err := h.sessionIdentity(r); err != nil {
		return err
	}
	rows, err := h.svc.insertRows(r.Context(), "performance.feedback_assignments", sets)
	if err != nil {
		return err
	}
	return httpx.JSON(w, http.StatusCreated, dataBody{rows})
}

const assignmentDetailSelect = `SELECT x.*,
	(SELECT row_to_json(e) FROM (SELECT id, name, period_label, is_anonymous FROM performance.feedback_cycles WHERE id = x.cycle_id) e) AS cycle,
	NULL AS employee, NULL AS reviewer,
	COALESCE((SELECT json_agg(e) FROM (
	   SELECT r.*, (SELECT row_to_json(e2) FROM (
	             SELECT c.id, c.name, c.description,
	                    (SELECT row_to_json(e3) FROM (SELECT id, name FROM performance.feedback_categories WHERE id = c.category_id) e3) AS category
	               FROM performance.feedback_criteria c WHERE c.id = r.criteria_id) e2) AS criteria
	     FROM performance.feedback_responses r WHERE r.assignment_id = x.id) e), '[]'::json) AS responses
	FROM performance.feedback_assignments x WHERE x.id = $1`

// GET /api/hris/feedback-assignments/{id}
func (h *handler) getAssignment(w http.ResponseWriter, r *http.Request) error {
	if err := h.requireFeedbackAdmin(r); err != nil {
		return err
	}
	row, err := queryObj(r.Context(), h.svc.db, assignmentDetailSelect, r.PathValue("id"))
	if err != nil {
		return err
	}
	if row == nil {
		return httpx.NotFound("Assignment not found")
	}
	if err := h.svc.stitch(r.Context(), h.svc.db, []*obj{row},
		embed{"employee", "employee_id", []string{"id", "full_name", "nip", "department", "position"}},
		embed{"reviewer", "reviewer_id", []string{"id", "full_name", "nip", "department"}}); err != nil {
		return err
	}
	return writeJSON(w, dataBody{row})
}

// PUT /api/hris/feedback-assignments/{id}
func (h *handler) updateAssignment(w http.ResponseWriter, r *http.Request) error {
	if err := h.requireFeedbackAdmin(r); err != nil {
		return err
	}
	const msg = "Data tidak valid"
	f, err := readJSON(r, msg)
	if err != nil {
		return err
	}
	set := parseAssignmentUpdate(f)
	if err := issuesErr(f, msg); err != nil {
		return err
	}
	if _, _, err := h.sessionIdentity(r); err != nil {
		return err
	}
	// submitted_at is stamped when the status moves to submitted.
	submittedAt, _ := field(f, "submitted_at")
	if v, _ := field(f, "status"); v == "submitted" && (submittedAt == nil || submittedAt == "") {
		if set.has("submitted_at") {
			for i := range set.cols {
				if set.cols[i].name == "submitted_at" {
					set.cols[i].value = h.svc.nowISO()
				}
			}
		} else {
			set.add("submitted_at", h.svc.nowISO())
		}
	}
	row, err := h.svc.updateRow(r.Context(), "performance.feedback_assignments", r.PathValue("id"), set.cols)
	if err != nil {
		return err
	}
	return writeJSON(w, dataBody{row})
}

// DELETE /api/hris/feedback-assignments/{id}
func (h *handler) deleteAssignment(w http.ResponseWriter, r *http.Request) error {
	if err := h.requireFeedbackAdmin(r); err != nil {
		return err
	}
	if _, err := h.svc.db.Exec(r.Context(), `DELETE FROM performance.feedback_assignments WHERE id = $1`, r.PathValue("id")); err != nil {
		return err
	}
	return writeJSON(w, messageBody{"Assignment deleted successfully"})
}
