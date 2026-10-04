package domain

import (
	"regexp"
	"slices"
	"strings"
)

// WorkflowObjects are the record types a workflow rule can target.
var WorkflowObjects = []string{"lead", "deal", "account", "contact", "task", "quotation"}

// WorkflowTriggers are the rule triggers.
var WorkflowTriggers = []string{"created", "updated", "stage_changed", "status_changed", "score_reached", "inactive_days", "due_soon"}

// ConditionOps are the condition operators.
var ConditionOps = []string{"eq", "neq", "in", "not_in", "contains", "gt", "gte", "lt", "lte", "is_empty", "not_empty", "changed", "changed_to"}

// UpdatableFields whitelists the fields update_field may write per object.
var UpdatableFields = map[string][]string{
	"lead":      {"temperature", "status", "source", "notes", "city"},
	"deal":      {"event_type", "pax_estimate", "is_event_date_fixed"},
	"account":   {"account_type", "industry", "city", "notes"},
	"contact":   {"title", "notes"},
	"task":      {"priority", "status", "notes"},
	"quotation": {"notes"},
}

// CanUpdateField reports whether update_field may write field on object.
func CanUpdateField(object, field string) bool {
	return slices.Contains(UpdatableFields[object], field)
}

// Condition is one rule condition; Value is Undefined when not set.
type Condition struct {
	Field string
	Op    string
	Value any
}

// Change is one entry of the updated-record change map.
type Change struct{ From, To any }

func norm(v any) string {
	if IsNullish(v) {
		return ""
	}
	if b, ok := v.(bool); ok {
		if b {
			return "true"
		}
		return "false"
	}
	return strings.ToLower(JSTrim(JSString(v)))
}

func inList(list any, a string) bool {
	items, ok := list.([]any)
	if !ok {
		return false
	}
	for _, it := range items {
		if norm(it) == a {
			return true
		}
	}
	return false
}

// EvaluateCondition mirrors evaluateCondition in lib/crm/workflow.ts.
func EvaluateCondition(c Condition, record map[string]any, changes map[string]Change) bool {
	actual := Lookup(record, c.Field)
	a, v := norm(actual), norm(c.Value)
	switch c.Op {
	case "eq":
		return a == v
	case "neq":
		return a != v
	case "in":
		return inList(c.Value, a)
	case "not_in":
		return !inList(c.Value, a)
	case "contains":
		return len(v) > 0 && strings.Contains(a, v)
	case "gt":
		return JSNumber(actual) > JSNumber(c.Value)
	case "gte":
		return JSNumber(actual) >= JSNumber(c.Value)
	case "lt":
		return JSNumber(actual) < JSNumber(c.Value)
	case "lte":
		return JSNumber(actual) <= JSNumber(c.Value)
	case "is_empty":
		return len(a) == 0
	case "not_empty":
		return len(a) > 0
	case "changed":
		_, ok := changes[c.Field]
		return ok
	case "changed_to":
		ch, ok := changes[c.Field]
		return ok && norm(ch.To) == v
	}
	return false
}

// EvaluateConditions is AND over every condition; none always matches.
func EvaluateConditions(conds []Condition, record map[string]any, changes map[string]Change) bool {
	for _, c := range conds {
		if !EvaluateCondition(c, record, changes) {
			return false
		}
	}
	return true
}

var (
	placeholder = regexp.MustCompile(`\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}`)
	spaceRuns   = regexp.MustCompile(`[ \t]{2,}`)
)

// RenderTemplate fills {{path.to.value}} placeholders from a nested context:
// unknown keys render empty, numbers use the id-ID format.
func RenderTemplate(tpl string, ctx map[string]any) string {
	out := placeholder.ReplaceAllStringFunc(tpl, func(m string) string {
		path := placeholder.FindStringSubmatch(m)[1]
		var value any = ctx
		for _, key := range strings.Split(path, ".") {
			value = member(value, key)
		}
		switch x := value.(type) {
		case nil, undefined:
			return ""
		case float64:
			return FormatNumber(x, 3)
		}
		return JSString(value)
	})
	return JSTrim(spaceRuns.ReplaceAllString(out, " "))
}

// member is acc[key] when acc is an object holding key, else undefined.
func member(acc any, key string) any {
	switch x := acc.(type) {
	case map[string]any:
		return Lookup(x, key)
	case []any:
		for i := range x {
			if FormatJSNumber(float64(i)) == key {
				return x[i]
			}
		}
		if key == "length" {
			return float64(len(x))
		}
	}
	return Undefined
}

// TriggerForEvent maps an internal event type ("deal.stage_changed") to the
// rule object and trigger it fires.
func TriggerForEvent(eventType string) (object, trigger string, ok bool) {
	obj, evt, _ := strings.Cut(eventType, ".")
	evt, _, _ = strings.Cut(evt, ".")
	if !slices.Contains(WorkflowObjects, obj) {
		return "", "", false
	}
	switch evt {
	case "created", "updated", "stage_changed", "status_changed":
		return obj, evt, true
	case "done":
		return obj, "status_changed", true
	case "score_changed":
		return obj, "score_reached", true
	}
	return "", "", false
}

// SplitAtWait splits actions around the first wait: the actions before it
// run now, the ones after it run delayMs later ((days * 24 + hours) hours).
// wait reports whether an action is a wait and its days and hours.
func SplitAtWait[A any](actions []A, wait func(A) (isWait bool, days, hours float64)) (now, later []A, delayMs float64) {
	for i, a := range actions {
		if ok, days, hours := wait(a); ok {
			return actions[:i], actions[i+1:], (days*24 + hours) * 3_600_000
		}
	}
	return actions, nil, 0
}

// PickRoundRobin picks userIDs[previousRuns % len]; false when empty.
func PickRoundRobin(userIDs []string, previousRuns int) (string, bool) {
	if len(userIDs) == 0 {
		return "", false
	}
	return userIDs[previousRuns%len(userIDs)], true
}

// RunStatus is the workflow run status after its immediate actions.
func RunStatus(results, failed int, scheduled bool) string {
	switch {
	case failed == 0 && scheduled:
		return "scheduled"
	case failed == 0:
		return "success"
	case failed == results:
		return "failed"
	}
	return "partial"
}
