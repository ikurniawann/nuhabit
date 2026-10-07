package advance

import (
	"regexp"
	"slices"

	"nuhabit/backend/internal/modules/crm/advance/domain"
	"nuhabit/backend/internal/platform/validate"
)

// The request schemas of lib/crm/{approvals,workflow,scoring,custom-fields}.ts.
// Each parse function reads fields in schema order. With patch set it is
// patchSchemaOf(schema): every field optional, no defaults, no object refine.

var (
	optional     = validate.Rule{Optional: true}
	optNullable  = validate.Rule{Optional: true, Nullable: true}
	customFieldK = regexp.MustCompile(`^[a-z][a-z0-9_]{1,39}$`)
)

func trimmed(min, max int) validate.StrOpts { return validate.StrOpts{Trim: true, Min: min, Max: max} }

func enumOf(options ...string) validate.StrOpts {
	return validate.StrOpts{Check: validate.EnumCheck(options)}
}

// required is the rule of a required field (optional in a PATCH schema).
func required(patch bool) validate.Rule { return validate.Rule{Optional: patch} }

// sent reports whether the body carries key (zod keeps only sent keys).
func sent(f *validate.Form, key string) bool {
	_, ok := f.Fields()[key]
	return ok
}

// refinable mirrors zod v4: object refinements run unless a
// non-continuable issue (wrong type, bad enum, no union match) occurred.
func refinable(f *validate.Form) bool {
	for _, is := range f.Issues() {
		switch is.Code {
		case "invalid_type", "invalid_value", "invalid_union":
			return false
		}
	}
	return true
}

// patchCol is one column of a partial UPDATE; json columns take jsonb text.
type patchCol struct {
	name  string
	value any
	json  bool
}

// patchCols collects the sent fields in schema order.
type patchCols []patchCol

func (p *patchCols) add(f *validate.Form, key string, value any) {
	if sent(f, key) {
		*p = append(*p, patchCol{name: key, value: value})
	}
}

func (p *patchCols) addJSON(f *validate.Form, key string, value any) {
	if sent(f, key) {
		*p = append(*p, patchCol{name: key, value: value, json: true})
	}
}

// rawValue is z.unknown().optional().nullable(): the decoded value, nil for
// null, domain.Undefined when absent.
func rawValue(f *validate.Form, key string) any {
	if v, ok := f.Fields()[key]; ok {
		return v
	}
	return domain.Undefined
}

func deref[T any](p *T, def T) T {
	if p == nil {
		return def
	}
	return *p
}

/* ── approval rules ────────────────────────────────────────────────────── */

type approvalRuleInput struct {
	name           *string
	level          *int
	minDiscount    *float64
	approverRole   *string
	approverUserID *string
	isActive       bool
	cols           patchCols
}

func parseApprovalRule(f *validate.Form, patch bool) approvalRuleInput {
	var in approvalRuleInput
	in.name = f.Str("name", required(patch), trimmed(1, 120))
	in.level = f.Int("level", required(patch), validate.NumOpts{Min: validate.Bound(1), Max: validate.Bound(5)})
	in.minDiscount = f.Num("min_discount_percent", required(patch), validate.NumOpts{Min: validate.Bound(0), Max: validate.Bound(100)})
	in.approverRole = f.Str("approver_role", optNullable, trimmed(0, 40))
	in.approverUserID = f.Str("approver_user_id", optNullable, validate.StrOpts{Check: validate.UUIDCheck})
	active := f.Bool("is_active", optional)
	in.isActive = deref(active, true)
	if patch {
		in.cols.add(f, "name", in.name)
		in.cols.add(f, "level", in.level)
		in.cols.add(f, "min_discount_percent", in.minDiscount)
		in.cols.add(f, "approver_role", in.approverRole)
		in.cols.add(f, "approver_user_id", in.approverUserID)
		in.cols.add(f, "is_active", active)
		return in
	}
	if refinable(f) && deref(in.approverRole, "") == "" && deref(in.approverUserID, "") == "" {
		f.Fail(nil, "custom", "Pilih role atau user approver")
	}
	return in
}

/* ── approval decision ─────────────────────────────────────────────────── */

func parseDecision(f *validate.Form) (decision string, comment *string) {
	d := f.Str("decision", validate.Rule{}, enumOf("approve", "reject"))
	comment = f.Str("comment", optNullable, trimmed(0, 1000))
	return deref(d, ""), comment
}

/* ── scoring rules ─────────────────────────────────────────────────────── */

type scoringRuleInput struct {
	name, kind, field, operator, eventType *string
	value                                  any // domain.Undefined when absent
	windowDays                             *int
	maxCount, points, sortOrder            int
	isActive                               bool
	cols                                   patchCols
}

func parseScoringRule(f *validate.Form, patch bool) scoringRuleInput {
	var in scoringRuleInput
	in.name = f.Str("name", required(patch), trimmed(1, 120))
	in.kind = f.Str("kind", required(patch), enumOf("field", "event"))
	in.field = f.Str("field", optNullable, enumOf(domain.ScoringFields...))
	in.operator = f.Str("operator", optNullable, enumOf(domain.ScoringOperators...))
	in.value = rawValue(f, "value")
	in.eventType = f.Str("event_type", optNullable, enumOf(domain.ScoringEventTypes...))
	in.windowDays = f.Int("window_days", optNullable, validate.NumOpts{Min: validate.Bound(1), Max: validate.Bound(3650)})
	maxCount := f.Int("max_count", optional, validate.NumOpts{Min: validate.Bound(1), Max: validate.Bound(100)})
	points := f.Int("points", required(patch), validate.NumOpts{Min: validate.Bound(-100), Max: validate.Bound(100)})
	active := f.Bool("is_active", optional)
	sortOrder := f.Int("sort_order", optional, validate.NumOpts{})
	in.maxCount, in.points, in.isActive, in.sortOrder = deref(maxCount, 1), deref(points, 0), deref(active, true), deref(sortOrder, 0)
	if patch {
		in.cols.add(f, "name", in.name)
		in.cols.add(f, "kind", in.kind)
		in.cols.add(f, "field", in.field)
		in.cols.add(f, "operator", in.operator)
		in.cols.addJSON(f, "value", in.value)
		in.cols.add(f, "event_type", in.eventType)
		in.cols.add(f, "window_days", in.windowDays)
		in.cols.add(f, "max_count", maxCount)
		in.cols.add(f, "points", points)
		in.cols.add(f, "is_active", active)
		in.cols.add(f, "sort_order", sortOrder)
		return in
	}
	if !refinable(f) {
		return in
	}
	kind := deref(in.kind, "")
	if kind == "field" && (deref(in.field, "") == "" || deref(in.operator, "") == "") {
		f.Fail(nil, "custom", "Aturan field wajib punya field dan operator")
	}
	if kind == "event" && deref(in.eventType, "") == "" {
		f.Fail(nil, "custom", "Aturan event wajib punya event_type")
	}
	return in
}

/* ── custom fields ─────────────────────────────────────────────────────── */

var customFieldTypes = []string{"text", "textarea", "number", "date", "boolean", "picklist", "multipicklist", "url", "email", "phone"}

type customFieldInput struct {
	object, key, label, fieldType, helpText *string
	options                                 []string
	validation                              map[string]any
	isRequired, showInList, isActive        bool
	sortOrder                               int
	cols                                    patchCols
}

// parseCustomField parses customFieldSchema; the PATCH schema omits key and
// object (stripped like unknown keys).
func parseCustomField(f *validate.Form, patch bool) customFieldInput {
	var in customFieldInput
	if !patch {
		in.object = f.Str("object", validate.Rule{}, enumOf("lead", "deal", "account", "contact"))
		in.key = f.Str("key", validate.Rule{}, validate.StrOpts{Trim: true, Check: func(s string) (string, string, bool) {
			return "invalid_format", "key: huruf kecil, angka, underscore; diawali huruf", customFieldK.MatchString(s)
		}})
	}
	in.label = f.Str("label", required(patch), trimmed(1, 100))
	in.fieldType = f.Str("field_type", required(patch), enumOf(customFieldTypes...))
	in.options = f.Strings("options", optional, 100, trimmed(1, 100))
	isRequired := f.Bool("is_required", optional)
	if sent(f, "validation") {
		in.validation = parseFieldValidation(f.Child("validation"))
	}
	in.helpText = f.Str("help_text", optNullable, trimmed(0, 200))
	showInList := f.Bool("show_in_list", optional)
	sortOrder := f.Int("sort_order", optional, validate.NumOpts{})
	active := f.Bool("is_active", optional)
	in.isRequired, in.showInList, in.sortOrder, in.isActive = deref(isRequired, false), deref(showInList, false), deref(sortOrder, 0), deref(active, true)
	if patch {
		in.cols.add(f, "label", in.label)
		in.cols.add(f, "field_type", in.fieldType)
		in.cols.addJSON(f, "options", in.options)
		in.cols.add(f, "is_required", isRequired)
		in.cols.addJSON(f, "validation", in.validation)
		in.cols.add(f, "help_text", in.helpText)
		in.cols.add(f, "show_in_list", showInList)
		in.cols.add(f, "sort_order", sortOrder)
		in.cols.add(f, "is_active", active)
		return in
	}
	if in.options == nil {
		in.options = []string{}
	}
	if in.validation == nil {
		in.validation = map[string]any{}
	}
	ft := deref(in.fieldType, "")
	if refinable(f) && (ft == "picklist" || ft == "multipicklist") && len(in.options) == 0 {
		f.Fail(nil, "custom", "Picklist wajib punya minimal satu pilihan")
	}
	return in
}

func parseFieldValidation(c *validate.Form) map[string]any {
	out := map[string]any{}
	put := func(key string, v any, ok bool) {
		if ok {
			out[key] = v
		}
	}
	minV := c.Num("min", optional, validate.NumOpts{})
	put("min", deref(minV, 0), minV != nil)
	maxV := c.Num("max", optional, validate.NumOpts{})
	put("max", deref(maxV, 0), maxV != nil)
	minLen := c.Int("min_length", optional, validate.NumOpts{Min: validate.Bound(0)})
	put("min_length", deref(minLen, 0), minLen != nil)
	maxLen := c.Int("max_length", optional, validate.NumOpts{Min: validate.Bound(1)})
	put("max_length", deref(maxLen, 0), maxLen != nil)
	pattern := c.Str("pattern", optional, validate.StrOpts{Max: 200})
	put("pattern", deref(pattern, ""), pattern != nil)
	return out
}

/* ── workflow rules ────────────────────────────────────────────────────── */

type workflowRuleInput struct {
	name, description, object, triggerType *string
	triggerConfig                          map[string]any
	conditions                             []any
	actions                                []map[string]any
	runOncePerRecord, isActive             bool
}

func parseWorkflowRule(f *validate.Form) workflowRuleInput {
	in := workflowRuleInput{triggerConfig: map[string]any{}, conditions: []any{}}
	in.name = f.Str("name", validate.Rule{}, trimmed(1, 120))
	in.description = f.Str("description", optNullable, trimmed(0, 1000))
	in.object = f.Str("object", validate.Rule{}, enumOf(domain.WorkflowObjects...))
	in.triggerType = f.Str("trigger_type", validate.Rule{}, enumOf(domain.WorkflowTriggers...))
	if sent(f, "trigger_config") {
		c := f.Child("trigger_config")
		if days := c.Int("days", optional, validate.NumOpts{Min: validate.Bound(1), Max: validate.Bound(365)}); days != nil {
			in.triggerConfig["days"] = *days
		}
		if score := c.Int("score", optional, validate.NumOpts{}); score != nil {
			in.triggerConfig["score"] = *score
		}
		for _, key := range []string{"to_stage", "to_status"} {
			if v := c.Str(key, optNullable, trimmed(0, 40)); v != nil || (sent(c, key) && c.Fields()[key] == nil) {
				in.triggerConfig[key] = v
			}
		}
	}
	if items := f.List("conditions", optional, 20, func(list *validate.Form, i int, v any) {
		c := list.Item(i, v)
		cond := map[string]any{}
		cond["field"] = deref(c.Str("field", validate.Rule{}, trimmed(1, 60)), "")
		cond["op"] = deref(c.Str("op", validate.Rule{}, enumOf(domain.ConditionOps...)), "")
		if v := rawValue(c, "value"); v != domain.Undefined {
			cond["value"] = v
		}
		in.conditions = append(in.conditions, cond)
	}); items == nil {
		in.conditions = []any{}
	}
	items := f.List("actions", validate.Rule{}, 20, func(list *validate.Form, i int, v any) {
		if a := parseAction(list.Item(i, v)); a != nil {
			in.actions = append(in.actions, a)
		}
	})
	if items != nil && len(items) < 1 {
		f.Fail("actions", "too_small", "Too small: expected array to have >=1 items")
	}
	in.runOncePerRecord = deref(f.Bool("run_once_per_record", optional), true)
	in.isActive = deref(f.Bool("is_active", optional), true)
	if !refinable(f) {
		return in
	}
	trigger := deref(in.triggerType, "")
	if days, _ := in.triggerConfig["days"].(int); trigger == "inactive_days" && days == 0 {
		f.Fail(nil, "custom", "Trigger 'tidak ada aktivitas' butuh jumlah hari")
	}
	if days, _ := in.triggerConfig["days"].(int); trigger == "due_soon" && days == 0 {
		f.Fail(nil, "custom", "Trigger 'mendekati jatuh tempo' butuh jumlah hari")
	}
	if _, ok := in.triggerConfig["score"]; trigger == "score_reached" && !ok {
		f.Fail(nil, "custom", "Trigger 'skor tercapai' butuh ambang skor")
	}
	object := deref(in.object, "")
	for _, a := range in.actions {
		if field, _ := a["field"].(string); a["type"] == "update_field" && !domain.CanUpdateField(object, field) {
			f.Fail(nil, "custom", "Field pada aksi update_field tidak diizinkan untuk objek ini")
			break
		}
	}
	return in
}

var actionTypes = []string{"send_wa", "create_task", "assign_owner", "update_field", "notify_in_app", "webhook", "wait"}

// parseAction is the actionSchema discriminated union; nil when the item
// is not an object or names no known type.
func parseAction(a *validate.Form) map[string]any {
	if a.Fields() == nil {
		return nil
	}
	typ, _ := a.Fields()["type"].(string)
	if !slices.Contains(actionTypes, typ) {
		a.Fail("type", "invalid_union", "Invalid discriminator value. Expected 'send_wa' | 'create_task' | 'assign_owner' | 'update_field' | 'notify_in_app' | 'webhook' | 'wait'")
		return nil
	}
	out := map[string]any{"type": typ}
	str := func(key string, r validate.Rule, o validate.StrOpts) {
		if v := a.Str(key, r, o); v != nil {
			out[key] = *v
		} else if sent(a, key) && a.Fields()[key] == nil && r.Nullable {
			out[key] = nil
		}
	}
	strDefault := func(key, def string, o validate.StrOpts) { out[key] = deref(a.Str(key, optional, o), def) }
	num := func(key string, def float64, max float64) {
		out[key] = deref(a.Num(key, optional, validate.NumOpts{Min: validate.Bound(0), Max: validate.Bound(max)}), def)
	}
	switch typ {
	case "send_wa":
		strDefault("to", "owner", enumOf("owner", "pic", "number"))
		str("number", optNullable, trimmed(0, 30))
		str("message", validate.Rule{}, trimmed(1, 2000))
	case "create_task":
		str("title", validate.Rule{}, trimmed(1, 200))
		strDefault("activity_type", "tugas", enumOf("tugas", "telepon", "wa", "meeting", "email", "catatan"))
		str("notes", optNullable, trimmed(0, 2000))
		num("due_in_days", 1, 365)
		strDefault("priority", "normal", enumOf("low", "normal", "high", "urgent"))
		strDefault("assign_to", "owner", trimmed(0, 60))
	case "assign_owner":
		str("user_id", optNullable, validate.StrOpts{Check: validate.UUIDCheck})
		strDefault("strategy", "fixed", enumOf("fixed", "round_robin"))
		if ids := a.Strings("user_ids", optional, 20, validate.StrOpts{Check: validate.UUIDCheck}); ids != nil {
			out["user_ids"] = ids
		}
		out["only_if_empty"] = deref(a.Bool("only_if_empty", optional), true)
	case "update_field":
		str("field", validate.Rule{}, trimmed(1, 60))
		v, _, _ := a.Take("value", "nonoptional", validate.Rule{Nullable: true})
		out["value"] = v
	case "notify_in_app":
		strDefault("to", "owner", enumOf("owner", "user", "role"))
		str("user_id", optNullable, validate.StrOpts{Check: validate.UUIDCheck})
		str("role", optNullable, trimmed(0, 40))
		str("title", validate.Rule{}, trimmed(1, 150))
		str("message", validate.Rule{}, trimmed(1, 1000))
	case "webhook":
		str("url", validate.Rule{}, validate.StrOpts{Max: 500, Check: validate.URLCheck})
		str("secret", optNullable, validate.StrOpts{Max: 200})
	case "wait":
		num("hours", 0, 24*90)
		num("days", 0, 90)
	}
	return out
}
