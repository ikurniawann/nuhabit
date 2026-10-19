package payroll

import (
	"context"
	"errors"
	"math"
	"net/http"
	"regexp"
	"strings"

	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/validate"
)

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
