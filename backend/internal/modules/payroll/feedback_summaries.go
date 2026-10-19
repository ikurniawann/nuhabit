package payroll

import (
	"net/http"
	"strconv"
	"strings"

	"nuhabit/backend/internal/modules/payroll/domain"
	"nuhabit/backend/internal/platform/httpx"
)

// summaryListSelect embeds the summarised employee's development plans:
// hris.development_plans has no key to feedback_summaries, so they join on
// employee_id, with the TS field names (goal, progress).
const summaryListSelect = `SELECT x.*,
	(SELECT row_to_json(e) FROM (SELECT id, name, period_label, status FROM performance.feedback_cycles WHERE id = x.cycle_id) e) AS cycle,
	NULL AS employee,
	COALESCE((SELECT json_agg(e) FROM (
	   SELECT id, development_action AS goal, status, progress_percentage AS progress
	     FROM hris.development_plans WHERE employee_id = x.employee_id ORDER BY created_at) e), '[]'::json) AS development_plans
	FROM performance.feedback_summaries x`

// GET /api/hris/feedback-summaries?cycle_id&employee_id&min_score&max_score&page&limit
func (h *handler) listSummaries(w http.ResponseWriter, r *http.Request) error {
	if err := h.requireFeedbackAdmin(r); err != nil {
		return err
	}
	p := parsePagination(r, 50)
	q := r.URL.Query()
	var wh where
	for _, key := range []string{"cycle_id", "employee_id"} {
		if v := q.Get(key); v != "" {
			wh.eq("x."+key, v)
		}
	}
	for _, bound := range []struct{ key, op string }{{"min_score", ">="}, {"max_score", "<="}} {
		v := q.Get(bound.key)
		if v == "" {
			continue
		}
		score, err := strconv.ParseFloat(strings.TrimSpace(v), 64)
		if err != nil {
			return httpx.BadRequest(bound.key + " harus berupa angka")
		}
		wh.args = append(wh.args, score)
		wh.clauses = append(wh.clauses, "x.final_score "+bound.op+" $"+itoa(len(wh.args)))
	}
	rows, total, err := h.svc.page(r.Context(), "performance.feedback_summaries", summaryListSelect, wh, "x.final_score DESC", p)
	if err != nil {
		return err
	}
	if err := h.svc.stitch(r.Context(), h.svc.db, rows,
		embed{"employee", "employee_id", []string{"id", "full_name", "nip", "email", "department", "position"}}); err != nil {
		return err
	}
	return writeJSON(w, pageBody{rows, p.meta(total)})
}

// POST /api/hris/feedback-summaries: final score and grade are computed
// when both the KPI and the 360 score are sent.
func (h *handler) createSummary(w http.ResponseWriter, r *http.Request) error {
	if err := h.requireFeedbackAdmin(r); err != nil {
		return err
	}
	const msg = "Data tidak valid"
	f, err := readJSON(r, msg)
	if err != nil {
		return err
	}
	set := parseSummary(f)
	if err := issuesErr(f, msg); err != nil {
		return err
	}
	if _, _, err := h.sessionIdentity(r); err != nil {
		return err
	}
	kpi, hasKPI := numCol(set, "kpi_score")
	overall, hasOverall := numCol(set, "overall_360_score")
	if hasKPI && hasOverall {
		var kw, fw *string
		cycleID, _ := set.cols[0].value.(string)
		_ = h.svc.db.QueryRow(r.Context(), `SELECT kpi_weight::text, feedback_weight::text FROM performance.feedback_cycles WHERE id = $1`, cycleID).Scan(&kw, &fw)
		score, grade := domain.FinalScore(kpi, overall, weightOf(kw), weightOf(fw))
		set.add("final_score", numParam(score))
		set.add("final_grade", grade)
	}
	rows, err := h.svc.insertRows(r.Context(), "performance.feedback_summaries", []colSet{set})
	if err != nil {
		return err
	}
	return httpx.JSON(w, http.StatusCreated, dataBody{rows[0]})
}

func numCol(set colSet, name string) (float64, bool) {
	for _, c := range set.cols {
		if c.name == name {
			s, _ := c.value.(string)
			return domain.JSNumber(s), true
		}
	}
	return 0, false
}

// weightOf is `cycle?.x || default` on a numeric column: null keeps the
// default; any stored value (even "0.00", a truthy string) is used.
func weightOf(s *string) *float64 {
	if s == nil {
		return nil
	}
	v := domain.JSNumber(*s)
	return &v
}
