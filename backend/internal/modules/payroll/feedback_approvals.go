package payroll

import (
	"context"
	"fmt"
	"net/http"
	"strings"

	"nuhabit/backend/internal/platform/validate"
)

const approvalSelect = `SELECT x.*, NULL AS employee, NULL AS reviewer,
	(SELECT row_to_json(e) FROM (SELECT id, name, period_label, status FROM performance.feedback_cycles WHERE id = x.cycle_id) e) AS cycle,
	COALESCE((SELECT json_agg(e) FROM (
	   SELECT r.id, r.rating, r.comments,
	          (SELECT row_to_json(e2) FROM (
	             SELECT c.name, (SELECT row_to_json(e3) FROM (SELECT name FROM performance.feedback_categories WHERE id = c.category_id) e3) AS category
	               FROM performance.feedback_criteria c WHERE c.id = r.criteria_id) e2) AS criteria
	     FROM performance.feedback_responses r WHERE r.assignment_id = x.id) e), '[]'::json) AS responses
	FROM performance.feedback_assignments x`

type approvalStats struct {
	Total    int `json:"total"`
	Pending  int `json:"pending"`
	Approved int `json:"approved"`
	Rejected int `json:"rejected"`
}

// GET /api/hris/feedback-approvals?status&page&limit
func (h *handler) listApprovals(w http.ResponseWriter, r *http.Request) error {
	if err := h.requireFeedbackAdmin(r); err != nil {
		return err
	}
	p := parsePagination(r, 20)
	status := orDefault(r.URL.Query().Get("status"), "submitted")
	var wh where
	wh.eq("x.relationship_type", "self")
	switch status {
	case "pending", "submitted":
		wh.eq("x.status", "submitted")
	case "approved", "rejected":
		wh.eq("x.status", status)
	case "all":
		wh.clauses = append(wh.clauses, "x.status IN ('submitted', 'approved', 'rejected')")
	}
	rows, total, err := h.svc.page(r.Context(), "performance.feedback_assignments", approvalSelect, wh, "x.submitted_at DESC", p)
	if err != nil {
		return err
	}
	if err := h.svc.stitch(r.Context(), h.svc.db, rows,
		embed{"employee", "employee_id", []string{"id", "nip", "full_name", "email", "department", "position"}},
		embed{"reviewer", "reviewer_id", []string{"id", "nip", "full_name"}}); err != nil {
		return err
	}
	stats := approvalStats{Total: total}
	for _, row := range rows {
		switch row.Get("status") {
		case "submitted":
			stats.Pending++
		case "approved":
			stats.Approved++
		case "rejected":
			stats.Rejected++
		}
	}
	return writeJSON(w, struct {
		Data       any            `json:"data"`
		Stats      approvalStats  `json:"stats"`
		Pagination paginationMeta `json:"pagination"`
	}{rows, stats, p.meta(total)})
}

// decision is FeedbackDecision.
type decision struct {
	approve  bool
	comments *string
	reason   string
}

func (s *service) decisionCols(d decision, approverID string) []column {
	status := "rejected"
	if d.approve {
		status = "approved"
	}
	cols := []column{{"status", status}, {"approved_by", approverID}, {"approved_at", s.nowISO()}}
	if d.approve {
		return append(cols, column{"manager_comments", d.comments})
	}
	return append(cols, column{"rejection_reason", d.reason})
}

func (s *service) decideAssignments(ctx context.Context, ids []string, d decision, approverID string) ([]*obj, error) {
	cols := s.decisionCols(d, approverID)
	sets, args := make([]string, len(cols)), []any{}
	for i, c := range cols {
		sets[i] = c.name + " = $" + itoa(i+1)
		args = append(args, c.value)
	}
	cond := "false"
	if len(ids) > 0 {
		marks := make([]string, len(ids))
		for i, id := range ids {
			args = append(args, id)
			marks[i] = "$" + itoa(len(args))
		}
		cond = "id IN (" + strings.Join(marks, ", ") + ")"
	}
	return queryObjs(ctx, s.db, `UPDATE performance.feedback_assignments SET `+strings.Join(sets, ", ")+` WHERE `+cond+` RETURNING *`, args...)
}

type decisionBody struct {
	Success bool   `json:"success"`
	Data    any    `json:"data"`
	Message string `json:"message"`
}

// POST /api/hris/feedback-approvals { assignment_ids, action, comments?, rejection_reason? }
func (h *handler) bulkDecide(w http.ResponseWriter, r *http.Request) error {
	if err := h.requireFeedbackAdmin(r); err != nil {
		return err
	}
	f, err := readJSON(r, "")
	if err != nil {
		return err
	}
	before := len(f.Issues())
	var ids []string
	list := f.List("assignment_ids", validate.Rule{}, 500, func(sub *validate.Form, i int, v any) {
		s, _ := sub.CheckString(i, v, validate.StrOpts{Check: func(s string) (string, string, bool) {
			return "invalid_format", "Invalid GUID", guidRE.MatchString(s)
		}})
		ids = append(ids, s)
	})
	if list == nil {
		for i := before; i < len(f.Issues()); i++ {
			f.Issues()[i].Message = "assignment_ids is required"
		}
	}
	before = len(f.Issues())
	action := f.Enum("action", validate.Rule{}, []string{"approve", "reject"})
	for i := before; i < len(f.Issues()); i++ {
		f.Issues()[i].Message = `Action must be "approve" or "reject"`
	}
	comments := f.Str("comments", nullish, validate.StrOpts{Max: 5000})
	reason := f.Str("rejection_reason", optional, validate.StrOpts{Max: 5000})
	if err := issuesErr(f, ""); err != nil {
		return err
	}
	approver, err := h.approverID(r, "User not found in employees table")
	if err != nil {
		return err
	}
	d := decision{approve: *action == "approve", comments: comments}
	if reason != nil {
		d.reason = *reason
	}
	rows, err := h.svc.decideAssignments(r.Context(), ids, d, approver)
	if err != nil {
		return err
	}
	return writeJSON(w, decisionBody{true, rows, fmt.Sprintf("Successfully %sd %d submission(s)", *action, len(rows))})
}

func (s *service) decideOne(ctx context.Context, id string, d decision, approverID string) (*obj, error) {
	return s.updateRow(ctx, "performance.feedback_assignments", id, s.decisionCols(d, approverID))
}

// POST /api/hris/feedback-approvals/approve { assignment_id, manager_comments? }
func (h *handler) approveAssignment(w http.ResponseWriter, r *http.Request) error {
	if err := h.requireFeedbackAdmin(r); err != nil {
		return err
	}
	f, err := readJSON(r, "")
	if err != nil {
		return err
	}
	id := guid(f, "assignment_id", "assignment_id is required")
	comments := f.Str("manager_comments", nullish, validate.StrOpts{Max: 5000})
	if err := issuesErr(f, ""); err != nil {
		return err
	}
	approver, err := h.approverID(r, "No valid employee found for approval")
	if err != nil {
		return err
	}
	row, err := h.svc.decideOne(r.Context(), *id, decision{approve: true, comments: orNil(comments)}, approver)
	if err != nil {
		return err
	}
	return writeJSON(w, decisionBody{true, row, "Feedback approved successfully"})
}

// rejectionReason is z.string({ error }).[trim()].min(1).max(5000) with the
// same message on every issue.
func rejectionReason(f *validate.Form, trim bool) *string {
	const msg = "Rejection reason is required"
	before := len(f.Issues())
	s := f.Str("rejection_reason", validate.Rule{}, validate.StrOpts{Trim: trim, Min: 1, Max: 5000})
	for i := before; i < len(f.Issues()); i++ {
		if f.Issues()[i].Code != "too_big" {
			f.Issues()[i].Message = msg
		}
	}
	return s
}

// POST /api/hris/feedback-approvals/reject { assignment_id, rejection_reason }
func (h *handler) rejectAssignment(w http.ResponseWriter, r *http.Request) error {
	if err := h.requireFeedbackAdmin(r); err != nil {
		return err
	}
	f, err := readJSON(r, "")
	if err != nil {
		return err
	}
	id := guid(f, "assignment_id", "assignment_id is required")
	reason := rejectionReason(f, true)
	if err := issuesErr(f, ""); err != nil {
		return err
	}
	approver, err := h.approverID(r, "No valid employee found for rejection")
	if err != nil {
		return err
	}
	row, err := h.svc.decideOne(r.Context(), *id, decision{reason: *reason}, approver)
	if err != nil {
		return err
	}
	return writeJSON(w, decisionBody{true, row, "Feedback rejected. Employee has been notified."})
}
