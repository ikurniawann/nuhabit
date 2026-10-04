package advance

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"time"

	"github.com/jackc/pgx/v5/pgconn"

	"nuhabit/backend/internal/modules/crm/advance/domain"
	"nuhabit/backend/internal/modules/crm/internal/kit"
)

// The CRM event bus and workflow engine of lib/crm/events.ts and
// lib/crm/workflow-engine.ts. Everything here is best effort: failures are
// logged and never reach the caller's response, like emitCrmEvent.

// crmEvent mirrors CrmEventInput.
type crmEvent struct {
	EventType, SubjectType, SubjectID string
	CompanyID, BranchID               *string
	Payload                           map[string]any
	ActorUserID                       *string
	Changes                           map[string]domain.Change
}

// emitCrmEvent records the event, runs the matching workflow rules, then
// rescores the affected lead (emitting lead.score_changed when it moved).
func (h *handler) emitCrmEvent(ctx context.Context, ev crmEvent) {
	if err := h.processCrmEvent(ctx, ev); err != nil {
		h.log.Error("[crm-events] "+ev.EventType+" gagal diproses", "error", err)
	}
}

func (h *handler) processCrmEvent(ctx context.Context, ev crmEvent) error {
	id, err := h.insertEvent(ctx, ev)
	if err != nil {
		return err
	}
	if err := h.processWorkflowEvent(ctx, ev, id); err != nil {
		return err
	}
	leadID, err := h.ports.Sales.AffectedLeadID(ctx, h.db, ev.SubjectType, ev.SubjectID)
	if err != nil || leadID == nil {
		return err
	}
	res, err := h.recalculateLeadScore(ctx, *leadID)
	if err != nil || res == nil || !res.changed {
		return err
	}
	companyID, branchID, err := h.ports.Sales.LeadVenue(ctx, h.db, *leadID)
	if err != nil {
		return err
	}
	score := crmEvent{
		EventType: "lead.score_changed", SubjectType: "lead", SubjectID: *leadID,
		CompanyID: coalesceStr(companyID, ev.CompanyID), BranchID: coalesceStr(branchID, ev.BranchID),
		Payload:     map[string]any{"previous_score": res.previous, "score": res.score, "source_event": ev.EventType},
		ActorUserID: ev.ActorUserID,
	}
	scoreID, err := h.insertEvent(ctx, score)
	if err != nil {
		return err
	}
	return h.processWorkflowEvent(ctx, score, scoreID)
}

func (h *handler) insertEvent(ctx context.Context, ev crmEvent) (*string, error) {
	payload := ev.Payload
	if payload == nil {
		payload = map[string]any{}
	}
	var id string
	err := h.db.QueryRow(ctx, `INSERT INTO crm.crm_events (company_id, branch_id, event_type, subject_type, subject_id, payload, actor_user_id)
       VALUES ($1, $2, $3, $4, $5, $6::text::jsonb, $7) RETURNING id::text`,
		ev.CompanyID, ev.BranchID, ev.EventType, ev.SubjectType, ev.SubjectID, jsonbText(payload), ev.ActorUserID).Scan(&id)
	if err != nil {
		return nil, err
	}
	return &id, nil
}

/* ── rules ─────────────────────────────────────────────────────────────── */

type workflowRule struct {
	ID, Name, Object, TriggerType string
	TriggerConfig                 map[string]any
	Conditions                    []domain.Condition
	Actions                       []workflowAction
	RunOncePerRecord              bool
}

// workflowAction is one stored action; raw keeps the stored JSON for the
// scheduled-action queue.
type workflowAction struct {
	raw          json.RawMessage
	Type         string          `json:"type"`
	To           *string         `json:"to"`
	Number       *string         `json:"number"`
	Message      *string         `json:"message"`
	Title        *string         `json:"title"`
	ActivityType *string         `json:"activity_type"`
	Notes        *string         `json:"notes"`
	DueInDays    *float64        `json:"due_in_days"`
	Priority     *string         `json:"priority"`
	AssignTo     *string         `json:"assign_to"`
	UserID       *string         `json:"user_id"`
	Strategy     *string         `json:"strategy"`
	UserIDs      []string        `json:"user_ids"`
	OnlyIfEmpty  *bool           `json:"only_if_empty"`
	Field        *string         `json:"field"`
	Value        json.RawMessage `json:"value"`
	Role         *string         `json:"role"`
	URL          *string         `json:"url"`
	Secret       *string         `json:"secret"`
	Hours        *float64        `json:"hours"`
	Days         *float64        `json:"days"`
}

func decodeRule(id, name, object, trigger string, cfg, conds, actions []byte, once bool) (workflowRule, error) {
	rule := workflowRule{ID: id, Name: name, Object: object, TriggerType: trigger, RunOncePerRecord: once}
	if err := decodeJSValue(cfg, &rule.TriggerConfig); err != nil {
		return rule, err
	}
	var rawConds []map[string]any
	if err := decodeJSValue(conds, &rawConds); err != nil {
		return rule, err
	}
	for _, c := range rawConds {
		field, _ := c["field"].(string)
		op, _ := c["op"].(string)
		rule.Conditions = append(rule.Conditions, domain.Condition{Field: field, Op: op, Value: domain.Lookup(c, "value")})
	}
	var rawActions []json.RawMessage
	if err := json.Unmarshal(actions, &rawActions); err != nil {
		return rule, err
	}
	for _, raw := range rawActions {
		a := workflowAction{raw: raw}
		if err := json.Unmarshal(raw, &a); err != nil {
			return rule, err
		}
		rule.Actions = append(rule.Actions, a)
	}
	return rule, nil
}

// decodeJSValue is JSON.parse into dst (numbers as float64).
func decodeJSValue(raw []byte, dst any) error {
	if len(raw) == 0 {
		return nil
	}
	return json.Unmarshal(raw, dst)
}

const ruleColumns = `id::text, name, object, trigger_type, trigger_config, conditions, actions, run_once_per_record`

func (h *handler) matchingRules(ctx context.Context, object, trigger string, companyID *string) ([]workflowRule, error) {
	rows, err := h.db.Query(ctx, `SELECT `+ruleColumns+`
     FROM crm.crm_workflow_rules
     WHERE is_active AND object = $1 AND trigger_type = $2
       AND (company_id IS NULL OR company_id = $3)
     ORDER BY created_at`, object, trigger, companyID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []workflowRule
	for rows.Next() {
		var id, name, obj, trig string
		var cfg, conds, actions []byte
		var once bool
		if err := rows.Scan(&id, &name, &obj, &trig, &cfg, &conds, &actions, &once); err != nil {
			return nil, err
		}
		rule, err := decodeRule(id, name, obj, trig, cfg, conds, actions, once)
		if err != nil {
			return nil, err
		}
		out = append(out, rule)
	}
	return out, rows.Err()
}

// processWorkflowEvent runs the active rules matching the event; one
// failing rule does not stop the others.
func (h *handler) processWorkflowEvent(ctx context.Context, ev crmEvent, eventID *string) error {
	object, trigger, ok := domain.TriggerForEvent(ev.EventType)
	if !ok {
		return nil
	}
	rules, err := h.matchingRules(ctx, object, trigger, ev.CompanyID)
	if err != nil {
		return err
	}
	payload := ev.Payload
	if payload == nil {
		payload = map[string]any{}
	}
	for _, rule := range rules {
		in := runInput{object: object, subjectID: ev.SubjectID, companyID: ev.CompanyID, branchID: ev.BranchID,
			eventID: eventID, actorUserID: ev.ActorUserID, payload: payload, changes: ev.Changes}
		if err := h.runRuleForSubject(ctx, rule, in); err != nil {
			h.log.Error("[crm-workflow] rule "+rule.Name+" gagal", "error", err)
		}
	}
	return nil
}

type runInput struct {
	object, subjectID            string
	companyID, branchID, eventID *string
	actorUserID                  *string
	payload                      map[string]any
	changes                      map[string]domain.Change
}

func (h *handler) runRuleForSubject(ctx context.Context, rule workflowRule, in runInput) error {
	if rule.RunOncePerRecord {
		var ran bool
		err := h.db.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM crm.crm_workflow_runs WHERE rule_id = $1 AND subject_id = $2 AND status <> 'skipped')`,
			rule.ID, in.subjectID).Scan(&ran)
		if err != nil || ran {
			return err
		}
	}
	row, err := h.ports.Sales.Snapshot(ctx, h.db, in.object, in.subjectID)
	if err != nil || row == nil {
		return err
	}
	rec := newRecord(row)
	if !triggerConfigMatches(rule, rec, in.payload) {
		return nil
	}
	if !domain.EvaluateConditions(rule.Conditions, rec.vals, in.changes) {
		_, err := h.db.Exec(ctx, `INSERT INTO crm.crm_workflow_runs (rule_id, event_id, subject_type, subject_id, status, actions_result)
       VALUES ($1, $2, $3, $4, 'skipped', '[]'::jsonb)`, rule.ID, in.eventID, in.object, in.subjectID)
		return err
	}
	var runID string
	if err := h.db.QueryRow(ctx, `INSERT INTO crm.crm_workflow_runs (rule_id, event_id, subject_type, subject_id, status)
       VALUES ($1, $2, $3, $4, 'scheduled') RETURNING id::text`, rule.ID, in.eventID, in.object, in.subjectID).Scan(&runID); err != nil {
		return err
	}
	ac := &actionCtx{
		ruleID: &rule.ID, runID: &runID, companyID: coalesceStr(in.companyID, rec.str("company_id")),
		branchID: coalesceStr(in.branchID, rec.str("branch_id")), subjectType: in.object, subjectID: in.subjectID,
		rec: rec, template: templateContext(in.object, rec, in.payload), actorUserID: in.actorUserID,
	}
	results, scheduled, failed, err := h.runActions(ctx, rule.Actions, ac)
	if err != nil {
		return err
	}
	var errText *string
	if failed > 0 {
		s := domain.FormatJSNumber(float64(failed)) + " aksi gagal"
		errText = &s
	}
	if _, err := h.db.Exec(ctx, `UPDATE crm.crm_workflow_runs SET status = $2, actions_result = $3::text::jsonb, error = $4 WHERE id = $1`,
		runID, domain.RunStatus(len(results), failed, scheduled), jsonbText(results), errText); err != nil {
		return err
	}
	_, err = h.db.Exec(ctx, `UPDATE crm.crm_workflow_rules SET run_count = run_count + 1, last_run_at = now() WHERE id = $1`, rule.ID)
	return err
}

// triggerConfigMatches applies the trigger-specific filters: the target
// stage or status, and score_reached only when the score crosses the bar.
func triggerConfigMatches(rule workflowRule, rec *record, payload map[string]any) bool {
	cfg := rule.TriggerConfig
	text := func(v any) string {
		if domain.IsNullish(v) {
			return ""
		}
		return domain.JSString(v)
	}
	switch rule.TriggerType {
	case "stage_changed":
		if to, _ := cfg["to_stage"].(string); to != "" && text(rec.get("stage_code")) != to {
			return false
		}
	case "status_changed":
		if to, _ := cfg["to_status"].(string); to != "" && text(rec.get("status")) != to {
			return false
		}
	case "score_reached":
		bar, ok := cfg["score"].(float64)
		if !ok {
			return true
		}
		score := domain.JSNumber(coalesce(rec.get("score"), 0.0))
		prev := domain.JSNumber(coalesce(domain.Lookup(payload, "previous_score"), math.Inf(-1)))
		if score < bar || prev >= bar {
			return false
		}
	}
	return true
}

/* ── record snapshot ───────────────────────────────────────────────────── */

// record is a workflow subject: row keeps the node-postgres shape (webhook
// payloads), vals the JavaScript values conditions and templates read.
type record struct {
	row  *kit.Row
	vals map[string]any
}

func newRecord(row *kit.Row) *record {
	r := &record{row: row, vals: map[string]any{}}
	for _, k := range row.Keys() {
		r.vals[k] = jsValue(row.Get(k))
	}
	return r
}

func (r *record) get(key string) any { return domain.Lookup(r.vals, key) }

// set is record[key] = v (actions mutate the snapshot for later actions).
func (r *record) set(key string, v any) {
	r.row.Set(key, v)
	r.vals[key] = jsValue(v)
}

// str is a text column ("" and non-strings are nil).
func (r *record) str(key string) *string {
	if s, ok := r.vals[key].(string); ok && s != "" {
		return &s
	}
	return nil
}

// jsValue converts a kit.Row value to what node-postgres hands JavaScript.
func jsValue(v any) any {
	switch x := v.(type) {
	case int64:
		return float64(x)
	case kit.JSTime:
		return time.Time(x)
	case json.RawMessage:
		var out any
		if json.Unmarshal(x, &out) != nil {
			return nil
		}
		return out
	case []any:
		out := make([]any, len(x))
		for i, e := range x {
			out[i] = jsValue(e)
		}
		return out
	}
	return v
}

// templateContext mirrors buildTemplateContext. The record map is shared,
// so field updates by earlier actions show in later templates.
func templateContext(object string, rec *record, payload map[string]any) map[string]any {
	base := map[string]any{
		"owner": map[string]any{"name": coalesce(rec.get("owner_name"), ""), "id": coalesce(rec.get("owner_user_id"), "")},
		"score": coalesce(rec.get("score"), 0.0),
		"stage": map[string]any{
			"name": coalesce(rec.get("stage_name"), domain.Lookup(payload, "to_stage_name"), ""),
			"code": coalesce(rec.get("stage_code"), ""),
		},
		"event": payload,
	}
	base[object] = rec.vals
	if object == "deal" || object == "quotation" {
		base["lead"] = map[string]any{"org_name": rec.get("org_name"), "pic_name": rec.get("pic_name"), "pic_phone": rec.get("pic_phone"), "source": rec.get("source")}
	}
	return base
}

// coalesce is a ?? b ?? c.
func coalesce(vals ...any) any {
	for _, v := range vals {
		if !domain.IsNullish(v) {
			return v
		}
	}
	return vals[len(vals)-1]
}

func coalesceStr(a, b *string) *string {
	if a != nil {
		return a
	}
	return b
}

// errMessage is err.message as the TS catch blocks record it (the bare
// PostgreSQL message for database errors).
func errMessage(err error) string {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return pgErr.Message
	}
	return err.Error()
}
