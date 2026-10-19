package payroll

import (
	"context"
	"math"
	"net/http"
	"strconv"
	"strings"

	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/iam"
)

// 360 feedback (lib/hris/feedback-repo.ts, feedback-schemas.ts). The
// performance.feedback_* tables belong to this module. The module has no UI
// yet; every route needs the KPI admin menus.
//
// Assignment embeds follow employee_id and reviewer_id. (The TS shim fell
// back to approved_by for constraint-name hints and unhinted embeds, so it
// showed the approver there; the Go routes fix that.)
//
// This file holds the shared pieces. Body parsing lives in
// feedback_parse.go and each route group in feedback_approvals.go,
// feedback_assignments.go, feedback_cycles.go (categories and cycles),
// feedback_responses.go and feedback_summaries.go.

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

func orNil(s *string) *string {
	if s == nil || *s == "" {
		return nil
	}
	return s
}
