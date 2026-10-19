package payroll

import (
	"net/http"

	"nuhabit/backend/internal/platform/httpx"
)

// GET /api/hris/feedback-categories
func (h *handler) listCategories(w http.ResponseWriter, r *http.Request) error {
	if err := h.requireFeedbackAdmin(r); err != nil {
		return err
	}
	rows, err := queryObjs(r.Context(), h.svc.db, `SELECT x.*, COALESCE((SELECT json_agg(e) FROM (
		   SELECT id, name, description, display_order FROM performance.feedback_criteria WHERE category_id = x.id) e), '[]'::json) AS criteria
		  FROM performance.feedback_categories x WHERE x.is_active = $1 ORDER BY x.display_order ASC`, true)
	if err != nil {
		return err
	}
	return writeJSON(w, dataBody{rows})
}

// POST /api/hris/feedback-categories
func (h *handler) createCategory(w http.ResponseWriter, r *http.Request) error {
	if err := h.requireFeedbackAdmin(r); err != nil {
		return err
	}
	const msg = "Data tidak valid"
	f, err := readJSON(r, msg)
	if err != nil {
		return err
	}
	set := parseCategory(f)
	if err := issuesErr(f, msg); err != nil {
		return err
	}
	rows, err := h.svc.insertRows(r.Context(), "performance.feedback_categories", []colSet{set})
	if err != nil {
		return err
	}
	return httpx.JSON(w, http.StatusCreated, dataBody{rows[0]})
}

// cycleListSelect renders the PostgREST aggregate embeds the TS asked for
// (`assignments_count:feedback_assignments(count)`) as [{"count": n}].
const cycleListSelect = `SELECT x.*,
	(SELECT json_build_array(json_build_object('count', count(*))) FROM performance.feedback_assignments a WHERE a.cycle_id = x.id) AS assignments_count,
	(SELECT json_build_array(json_build_object('count', count(*))) FROM performance.feedback_summaries s WHERE s.cycle_id = x.id) AS summaries_count
	FROM performance.feedback_cycles x`

// GET /api/hris/feedback-cycles?status&period_label&page&limit
func (h *handler) listFeedbackCycles(w http.ResponseWriter, r *http.Request) error {
	if err := h.requireFeedbackAdmin(r); err != nil {
		return err
	}
	p := parsePagination(r, 20)
	var wh where
	for _, key := range []string{"status", "period_label"} {
		if v := r.URL.Query().Get(key); v != "" {
			wh.eq("x."+key, v)
		}
	}
	rows, total, err := h.svc.page(r.Context(), "performance.feedback_cycles", cycleListSelect, wh, "x.created_at DESC", p)
	if err != nil {
		return err
	}
	if err := h.svc.stitch(r.Context(), h.svc.db, rows, embed{"created_by", "created_by", []string{"id", "full_name"}}); err != nil {
		return err
	}
	return writeJSON(w, pageBody{rows, p.meta(total)})
}

// POST /api/hris/feedback-cycles
func (h *handler) createFeedbackCycle(w http.ResponseWriter, r *http.Request) error {
	if err := h.requireFeedbackAdmin(r); err != nil {
		return err
	}
	const msg = "Data tidak valid"
	f, err := readJSON(r, msg)
	if err != nil {
		return err
	}
	set := parseCycle(f, false)
	if err := issuesErr(f, msg); err != nil {
		return err
	}
	// created_by references hris.employees: the account's linked employee,
	// else the employee with its email; never a guess.
	userID, email, err := h.sessionIdentity(r)
	if err != nil {
		return err
	}
	creator, err := h.svc.ports.Employees.IDByUser(r.Context(), h.svc.db, userID)
	if err == nil && creator == "" && email != "" {
		creator, err = h.svc.ports.Employees.IDByEmail(r.Context(), h.svc.db, email)
	}
	if err != nil {
		return err
	}
	if creator == "" {
		return httpx.Forbidden("Akun ini tidak terhubung ke data karyawan, tidak bisa membuat siklus feedback")
	}
	set.add("created_by", creator)
	rows, err := h.svc.insertRows(r.Context(), "performance.feedback_cycles", []colSet{set})
	if err != nil {
		return err
	}
	return httpx.JSON(w, http.StatusCreated, dataBody{rows[0]})
}

const cycleDetailSelect = `SELECT x.*,
	COALESCE((SELECT json_agg(e) FROM (SELECT a.*, a.employee_id AS employee, a.reviewer_id AS reviewer
	   FROM performance.feedback_assignments a WHERE a.cycle_id = x.id) e), '[]'::json) AS assignments,
	COALESCE((SELECT json_agg(e) FROM (SELECT s.*, s.employee_id AS employee
	   FROM performance.feedback_summaries s WHERE s.cycle_id = x.id) e), '[]'::json) AS summaries
	FROM performance.feedback_cycles x WHERE x.id = $1`

// GET /api/hris/feedback-cycles/{id}
func (h *handler) getFeedbackCycle(w http.ResponseWriter, r *http.Request) error {
	if err := h.requireFeedbackAdmin(r); err != nil {
		return err
	}
	row, err := queryObj(r.Context(), h.svc.db, cycleDetailSelect, r.PathValue("id"))
	if err != nil {
		return err
	}
	if row == nil {
		return httpx.NotFound("Cycle not found")
	}
	rows := []*obj{row}
	assignments, summaries := nested(rows, "assignments"), nested(rows, "summaries")
	if err := h.svc.stitchKeys(r.Context(),
		keySpec{rows, "created_by", []string{"id", "full_name"}},
		keySpec{assignments, "employee", []string{"id", "full_name", "nip"}},
		keySpec{assignments, "reviewer", []string{"id", "full_name"}},
		keySpec{summaries, "employee", []string{"id", "full_name", "department"}}); err != nil {
		return err
	}
	return writeJSON(w, dataBody{row})
}

// PUT /api/hris/feedback-cycles/{id}
func (h *handler) updateFeedbackCycle(w http.ResponseWriter, r *http.Request) error {
	if err := h.requireFeedbackAdmin(r); err != nil {
		return err
	}
	const msg = "Data tidak valid"
	f, err := readJSON(r, msg)
	if err != nil {
		return err
	}
	set := parseCycle(f, true)
	if err := issuesErr(f, msg); err != nil {
		return err
	}
	if _, _, err := h.sessionIdentity(r); err != nil {
		return err
	}
	set.add("updated_at", h.svc.nowISO())
	row, err := h.svc.updateRow(r.Context(), "performance.feedback_cycles", r.PathValue("id"), set.cols)
	if err != nil {
		return err
	}
	return writeJSON(w, dataBody{row})
}

// DELETE /api/hris/feedback-cycles/{id}
func (h *handler) deleteFeedbackCycle(w http.ResponseWriter, r *http.Request) error {
	if err := h.requireFeedbackAdmin(r); err != nil {
		return err
	}
	if _, err := h.svc.db.Exec(r.Context(), `DELETE FROM performance.feedback_cycles WHERE id = $1`, r.PathValue("id")); err != nil {
		return err
	}
	return writeJSON(w, messageBody{"Cycle deleted successfully"})
}
