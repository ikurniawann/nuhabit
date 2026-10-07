package payroll

import (
	"context"
	"errors"
	"fmt"
	"math"
	"net/http"
	"regexp"
	"strconv"
	"strings"

	"nuhabit/backend/internal/modules/payroll/domain"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/iam"
	"nuhabit/backend/internal/platform/validate"
)

// 360 feedback (lib/hris/feedback-repo.ts, feedback-schemas.ts). The
// performance.feedback_* tables belong to this module. The module has no UI
// yet; every route needs the KPI admin menus.
//
// Assignment embeds follow employee_id and reviewer_id. (The TS shim fell
// back to approved_by for constraint-name hints and unhinted embeds, so it
// showed the approver there; the Go routes fix that.)

/* ── shared pieces ───────────────────────────────────────────────────── */

type pagination struct{ Page, Limit, From int }

// jsParseInt is parseInt(s): leading whitespace, sign and digits; NaN
// otherwise (ok false).
func jsParseInt(s string) (int, bool) {
	s = strings.TrimLeft(s, " \t\n\r\f\v")
	end := 0
	if end < len(s) && (s[end] == '+' || s[end] == '-') {
		end++
	}
	start := end
	for end < len(s) && s[end] >= '0' && s[end] <= '9' {
		end++
	}
	if end == start {
		return 0, false
	}
	n, err := strconv.Atoi(s[:end])
	return n, err == nil
}

// parsePagination is parsePagination: page ≥ 1, limit ≥ 1 (0/NaN → default).
func parsePagination(r *http.Request, def int) pagination {
	q := r.URL.Query()
	page := 1
	if p, ok := jsParseInt(orDefault(q.Get("page"), "1")); ok && p != 0 {
		page = max(1, p)
	}
	limit := def
	if l, ok := jsParseInt(orDefault(q.Get("limit"), itoa(def))); ok && l != 0 {
		limit = max(1, l)
	}
	return pagination{Page: page, Limit: limit, From: (page - 1) * limit}
}

func orDefault(s, def string) string {
	if s == "" {
		return def
	}
	return s
}

type paginationMeta struct {
	Page       int `json:"page"`
	Limit      int `json:"limit"`
	Total      int `json:"total"`
	TotalPages int `json:"totalPages"`
}

func (p pagination) meta(total int) paginationMeta {
	return paginationMeta{p.Page, p.Limit, total, int(math.Ceil(float64(total) / float64(p.Limit)))}
}

type pageBody struct {
	Data       any            `json:"data"`
	Pagination paginationMeta `json:"pagination"`
}

// where builds "col = $n" filters for non-empty query parameters.
type where struct {
	clauses []string
	args    []any
}

func (w *where) eq(col string, v any) {
	w.args = append(w.args, v)
	w.clauses = append(w.clauses, col+" = $"+itoa(len(w.args)))
}

func (w *where) sql() string {
	if len(w.clauses) == 0 {
		return ""
	}
	return " WHERE " + strings.Join(w.clauses, " AND ")
}

// page runs the count and the page query of a list (count first, as the
// query builder's { count: "exact" } does).
func (s *service) page(ctx context.Context, table, selectSQL string, w where, orderBy string, p pagination) ([]*obj, int, error) {
	var total int
	if err := s.db.QueryRow(ctx, `SELECT count(*)::int FROM `+table+` x`+w.sql(), w.args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	args := append(append([]any{}, w.args...), p.Limit, p.From)
	n := len(w.args)
	rows, err := queryObjs(ctx, s.db, selectSQL+w.sql()+` ORDER BY `+orderBy+` LIMIT $`+itoa(n+1)+` OFFSET $`+itoa(n+2), args...)
	return rows, total, err
}

// stitchKeys replaces, in every object, key's employee id with the
// employee embed (null when the id is null or unknown).
type keySpec struct {
	objs   []*obj
	key    string
	fields []string
}

func (s *service) stitchKeys(ctx context.Context, specs ...keySpec) error {
	var ids []string
	for _, sp := range specs {
		for _, o := range sp.objs {
			if id, ok := o.Get(sp.key).(string); ok {
				ids = append(ids, id)
			}
		}
	}
	briefs := map[string]EmployeeBrief{}
	if len(ids) > 0 {
		var err error
		if briefs, err = s.ports.Employees.Briefs(ctx, s.db, ids); err != nil {
			return err
		}
	}
	for _, sp := range specs {
		for _, o := range sp.objs {
			id, _ := o.Get(sp.key).(string)
			if b, ok := briefs[id]; ok {
				o.Set(sp.key, employeeObj(&b, sp.fields))
			} else {
				o.Set(sp.key, nil)
			}
		}
	}
	return nil
}

// nested returns the objects under key of each row (an object or an array of objects).
func nested(rows []*obj, key string) []*obj {
	var out []*obj
	for _, r := range rows {
		switch v := r.Get(key).(type) {
		case *obj:
			out = append(out, v)
		case []any:
			for _, it := range v {
				if o, ok := it.(*obj); ok {
					out = append(out, o)
				}
			}
		}
	}
	return out
}

// sessionIdentity is authIdentity: the signed-in account's id and email.
func (h *handler) sessionIdentity(r *http.Request) (string, string, error) {
	su, err := h.auth.Session(r)
	if err != nil {
		return "", "", err
	}
	if su == nil {
		return "", "", httpx.Unauthorized("Unauthorized")
	}
	return su.ID, su.Email, nil
}

// approverID is requireApproverEmployeeId: the employee with the account's email.
func (h *handler) approverID(r *http.Request, notFound string) (string, error) {
	_, email, err := h.sessionIdentity(r)
	if err != nil {
		return "", err
	}
	id := ""
	if email != "" {
		if id, err = h.svc.ports.Employees.IDByEmail(r.Context(), h.svc.db, email); err != nil {
			return "", err
		}
	}
	if id == "" {
		return "", httpx.NotFound(notFound)
	}
	return id, nil
}

func (h *handler) requireFeedbackAdmin(r *http.Request) error {
	_, err := h.auth.RequireMenuPrefix(r, iam.HrisPerformanceAdmin...)
	return err
}

/* ── body parsing ────────────────────────────────────────────────────── */

var guidRE = regexp.MustCompile(`^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$`)

// guid is z.guid({ error: msg }) (msg "" keeps "Invalid GUID").
func guid(f *validate.Form, key, msg string) *string {
	before := len(f.Issues())
	s := f.Str(key, validate.Rule{}, validate.StrOpts{Check: func(s string) (string, string, bool) {
		return "invalid_format", "Invalid GUID", guidRE.MatchString(s)
	}})
	if msg != "" {
		for i := before; i < len(f.Issues()); i++ {
			f.Issues()[i].Message = msg
		}
	}
	return s
}

// colSet collects the validated columns of a write in schema order.
type colSet struct{ cols []column }

func (c *colSet) add(name string, v any) { c.cols = append(c.cols, column{name, v}) }

func (c *colSet) has(name string) bool {
	for _, col := range c.cols {
		if col.name == name {
			return true
		}
	}
	return false
}

func (c *colSet) str(f *validate.Form, key string, r validate.Rule, o validate.StrOpts) {
	v, ok := field(f, key)
	if !ok {
		if !r.Optional {
			f.Str(key, r, o) // records the missing required field
		}
		return
	}
	if s := f.Str(key, r, o); s != nil {
		c.add(key, *s)
	} else if v == nil && r.Nullable {
		c.add(key, nil)
	}
}

func (c *colSet) num(f *validate.Form, key string, o validate.NumOpts) {
	if _, ok := field(f, key); !ok {
		return
	}
	if n := f.Num(key, optional, o); n != nil {
		c.add(key, numParam(*n))
	}
}

func (c *colSet) boolean(f *validate.Form, key string) {
	if b := f.Bool(key, optional); b != nil {
		c.add(key, *b)
	}
}

func (c *colSet) uuid(f *validate.Form, key string, r validate.Rule) {
	if _, ok := field(f, key); !ok && r.Optional {
		return
	}
	if s := f.UUID(key, r); s != nil {
		c.add(key, *s)
	}
}

func (c *colSet) strings(f *validate.Form, key string, max int) {
	if _, ok := field(f, key); !ok {
		return
	}
	if list := f.Strings(key, optional, math.MaxInt, validate.StrOpts{Max: max}); list != nil {
		c.add(key, list)
	}
}

var score100 = validate.NumOpts{Min: validate.Bound(0), Max: validate.Bound(100)}

func parseCategory(f *validate.Form) colSet {
	var c colSet
	c.str(f, "name", validate.Rule{}, validate.StrOpts{Trim: true, Min: 1, Max: 120})
	c.str(f, "description", nullish, validate.StrOpts{Max: 2000})
	c.num(f, "weight", score100)
	c.num(f, "display_order", validate.NumOpts{Integer: true})
	c.boolean(f, "is_active")
	return c
}

func parseCycle(f *validate.Form, partial bool) colSet {
	var c colSet
	nameRule := validate.Rule{Optional: partial}
	c.str(f, "name", nameRule, validate.StrOpts{Trim: true, Min: 1, Max: 255})
	c.str(f, "period_label", optional, validate.StrOpts{Max: 50})
	c.str(f, "start_date", optional, validate.StrOpts{Max: 10})
	c.str(f, "end_date", optional, validate.StrOpts{Max: 10})
	c.str(f, "status", optional, validate.StrOpts{Max: 30})
	c.num(f, "kpi_weight", score100)
	c.num(f, "feedback_weight", score100)
	c.boolean(f, "is_anonymous")
	c.boolean(f, "allow_self_assessment")
	c.boolean(f, "require_manager_review")
	return c
}

func parseAssignment(f *validate.Form) colSet {
	var c colSet
	c.uuid(f, "cycle_id", validate.Rule{})
	c.uuid(f, "employee_id", validate.Rule{})
	c.uuid(f, "reviewer_id", validate.Rule{})
	if s := f.Str("relationship_type", validate.Rule{}, validate.StrOpts{Max: 30}); s != nil {
		c.add("relationship_type", *s)
	}
	c.str(f, "due_date", nullish, validate.StrOpts{Max: 10})
	return c
}

func parseAssignmentUpdate(f *validate.Form) colSet {
	var c colSet
	c.uuid(f, "reviewer_id", optional)
	c.str(f, "relationship_type", optional, validate.StrOpts{Max: 30})
	if s := f.Enum("status", optional, []string{"pending", "in_progress", "submitted"}); s != nil {
		c.add("status", *s)
	}
	c.str(f, "due_date", nullish, validate.StrOpts{Max: 10})
	c.str(f, "started_at", nullish, validate.StrOpts{Max: 40})
	c.str(f, "submitted_at", nullish, validate.StrOpts{Max: 40})
	return c
}

func parseResponse(f *validate.Form, partial bool) colSet {
	var c colSet
	if !partial {
		c.uuid(f, "assignment_id", validate.Rule{})
		c.uuid(f, "criteria_id", validate.Rule{})
	}
	rule := validate.Rule{}
	if partial {
		rule = optional
	}
	if _, ok := field(f, "rating"); ok || !partial {
		if n := f.Int("rating", rule, validate.NumOpts{Min: validate.Bound(1), Max: validate.Bound(5)}); n != nil {
			c.add("rating", *n)
		}
	}
	c.str(f, "comments", nullish, validate.StrOpts{Max: 5000})
	return c
}

func parseSummary(f *validate.Form) colSet {
	var c colSet
	c.uuid(f, "cycle_id", validate.Rule{})
	c.uuid(f, "employee_id", validate.Rule{})
	for _, k := range []string{"leadership_score", "communication_score", "collaboration_score", "accountability_score",
		"problem_solving_score", "overall_360_score", "kpi_score"} {
		c.num(f, k, score100)
	}
	c.str(f, "manager_comments", nullish, validate.StrOpts{Max: 5000})
	c.strings(f, "strengths", 500)
	c.strings(f, "weaknesses", 500)
	c.str(f, "burnout_risk", optional, validate.StrOpts{Max: 30})
	c.str(f, "promotion_potential", optional, validate.StrOpts{Max: 30})
	return c
}

// oneOrMany is z.union([schema, z.array(schema).min(1).max(500)]): an array
// body is validated item by item, anything else as one object.
func oneOrMany(r *http.Request, parse func(*validate.Form) colSet) ([]colSet, bool, error) {
	const msg = "Data tidak valid"
	body, ok := validate.ReadBody(r)
	if !ok {
		return nil, false, httpx.BadRequest(msg)
	}
	items, isArray := body.([]any)
	if !isArray {
		f := validate.New(body, true)
		if f.Fields() == nil {
			return nil, false, httpx.BadRequest(msg, []validate.Issue{{Code: "invalid_union", Path: []any{}, Message: "Invalid input"}})
		}
		set := parse(f)
		return []colSet{set}, false, issuesErr(f, msg)
	}
	var sets []colSet
	issues := []validate.Issue{}
	for i, it := range items {
		f := validate.New(it, true)
		sets = append(sets, parse(f))
		for _, is := range f.Issues() {
			is.Path = append([]any{i}, is.Path...)
			issues = append(issues, is)
		}
	}
	if len(items) == 0 {
		issues = append(issues, validate.Issue{Code: "too_small", Path: []any{}, Message: "Too small: expected array to have >=1 items"})
	}
	if len(items) > 500 {
		issues = append(issues, validate.Issue{Code: "too_big", Path: []any{}, Message: "Too big: expected array to have <=500 items"})
	}
	if len(issues) > 0 {
		return nil, true, httpx.BadRequest(msg, issues)
	}
	return sets, true, nil
}

// insertRows inserts the column sets (columns = union in first-seen order;
// a row without a column writes NULL, as the query builder does).
func (s *service) insertRows(ctx context.Context, table string, sets []colSet) ([]*obj, error) {
	var names []string
	seen := map[string]bool{}
	for _, set := range sets {
		for _, c := range set.cols {
			if !seen[c.name] {
				seen[c.name] = true
				names = append(names, c.name)
			}
		}
	}
	var args []any
	var tuples []string
	for _, set := range sets {
		marks := make([]string, len(names))
		for i, n := range names {
			var v any
			for _, c := range set.cols {
				if c.name == n {
					v = c.value
				}
			}
			args = append(args, v)
			marks[i] = "$" + itoa(len(args))
		}
		tuples = append(tuples, "("+strings.Join(marks, ", ")+")")
	}
	return queryObjs(ctx, s.db, `INSERT INTO `+table+` (`+strings.Join(names, ", ")+`) VALUES `+strings.Join(tuples, ", ")+` RETURNING *`, args...)
}

// updateRow is `.update(patch).eq("id", id).select().single()`: an empty
// patch is invalid SQL and no matching row is PGRST116, both 500s.
func (s *service) updateRow(ctx context.Context, table, id string, cols []column) (*obj, error) {
	if len(cols) == 0 {
		return nil, errors.New("update with no columns (syntax error in TS)")
	}
	sets, args := make([]string, len(cols)), make([]any, 0, len(cols)+1)
	for i, c := range cols {
		sets[i] = c.name + " = $" + itoa(i+1)
		args = append(args, c.value)
	}
	args = append(args, id)
	row, err := queryObj(ctx, s.db, `UPDATE `+table+` SET `+strings.Join(sets, ", ")+` WHERE id = $`+itoa(len(args))+` RETURNING *`, args...)
	if err == nil && row == nil {
		err = errNoRows
	}
	return row, err
}

/* ── approvals ───────────────────────────────────────────────────────── */

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

func orNil(s *string) *string {
	if s == nil || *s == "" {
		return nil
	}
	return s
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

/* ── assignments ─────────────────────────────────────────────────────── */

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

/* ── categories & cycles ─────────────────────────────────────────────── */

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

/* ── responses & summaries ───────────────────────────────────────────── */

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
