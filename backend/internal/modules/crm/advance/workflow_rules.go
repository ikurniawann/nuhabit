package advance

import (
	"net/http"

	"nuhabit/backend/internal/modules/crm/internal/kit"
	"nuhabit/backend/internal/platform/validate"
)

const workflowRuleNotFound = "Rule tidak ditemukan"

func (h *handler) listWorkflowRules(w http.ResponseWriter, r *http.Request) error {
	_, s, err := h.guard.RequireScope(r, kit.GateSettings)
	if err != nil {
		return err
	}
	args := []any{}
	rows, err := kit.Query(r.Context(), h.db, `SELECT r.id, r.company_id, r.name, r.description, r.object, r.trigger_type, r.trigger_config,
            r.conditions, r.actions, r.run_once_per_record, r.is_active, r.last_run_at, r.run_count, r.created_at, r.updated_at
     FROM crm.crm_workflow_rules r WHERE `+ruleVisibility("r", s, &args)+` ORDER BY r.created_at DESC`, args...)
	if err != nil {
		return err
	}
	return kit.OK(w, rows)
}

// workflowValues are the $n parameters shared by create and replace:
// name, description, object, trigger_type, trigger_config, conditions,
// actions, run_once_per_record, is_active.
func workflowValues(in workflowRuleInput) []any {
	return []any{in.name, in.description, in.object, in.triggerType, jsonbText(in.triggerConfig),
		jsonbText(in.conditions), jsonbText(in.actions), in.runOncePerRecord, in.isActive}
}

func (h *handler) createWorkflowRule(w http.ResponseWriter, r *http.Request) error {
	u, s, err := h.guard.RequireScope(r, kit.GateSettings)
	if err != nil {
		return err
	}
	f, err := kit.Form(r)
	if err != nil {
		return err
	}
	in := parseWorkflowRule(f)
	if err := f.Err("Validation failed"); err != nil {
		return err
	}
	args := append([]any{kit.ScopedCompanyID(u, s)}, workflowValues(in)...)
	row, err := kit.QueryOne(r.Context(), h.db, `INSERT INTO crm.crm_workflow_rules
       (company_id, name, description, object, trigger_type, trigger_config, conditions, actions, run_once_per_record, is_active, created_by)
     VALUES ($1, $2, $3, $4, $5, $6::text::jsonb, $7::text::jsonb, $8::text::jsonb, $9, $10, $11)
     RETURNING id, name, object, trigger_type, is_active`, append(args, u.ID)...)
	if err != nil {
		return err
	}
	return kit.Created(w, row, "Workflow rule dibuat")
}

func (h *handler) getWorkflowRule(w http.ResponseWriter, r *http.Request) error {
	id, err := h.settingsRule(r, "crm_workflow_rules", workflowRuleNotFound)
	if err != nil {
		return err
	}
	row, err := kit.QueryOne(r.Context(), h.db, `SELECT * FROM crm.crm_workflow_rules WHERE id = $1::text::uuid`, id)
	if err != nil {
		return err
	}
	return kit.OK(w, row)
}

// patchWorkflowRule toggles is_active when that is the only key sent (no
// full validation); anything else replaces the rule through the full schema.
func (h *handler) patchWorkflowRule(w http.ResponseWriter, r *http.Request) error {
	id, err := h.settingsRule(r, "crm_workflow_rules", workflowRuleNotFound)
	if err != nil {
		return err
	}
	body, err := kit.ReadJSON(r)
	if err != nil {
		return err
	}
	if obj, ok := body.(map[string]any); ok && len(obj) == 1 {
		if active, ok := obj["is_active"].(bool); ok {
			row, err := kit.QueryOne(r.Context(), h.db,
				`UPDATE crm.crm_workflow_rules SET is_active = $2, updated_at = now() WHERE id = $1::text::uuid RETURNING id, is_active`, id, active)
			if err != nil {
				return err
			}
			msg := "Rule dinonaktifkan"
			if active {
				msg = "Rule diaktifkan"
			}
			return kit.OK(w, row, msg)
		}
	}
	f := validate.New(body, true)
	in := parseWorkflowRule(f)
	if err := f.Err("Validation failed"); err != nil {
		return err
	}
	row, err := kit.QueryOne(r.Context(), h.db, `UPDATE crm.crm_workflow_rules
     SET name = $2, description = $3, object = $4, trigger_type = $5, trigger_config = $6::text::jsonb,
         conditions = $7::text::jsonb, actions = $8::text::jsonb, run_once_per_record = $9, is_active = $10, updated_at = now()
     WHERE id = $1::text::uuid RETURNING id, name, object, trigger_type, is_active`, append([]any{id}, workflowValues(in)...)...)
	if err != nil {
		return err
	}
	return kit.OK(w, row, "Workflow rule diperbarui")
}

func (h *handler) deleteWorkflowRule(w http.ResponseWriter, r *http.Request) error {
	id, err := h.settingsRule(r, "crm_workflow_rules", workflowRuleNotFound)
	if err != nil {
		return err
	}
	if err := h.deleteRule(r.Context(), "crm_workflow_rules", id); err != nil {
		return err
	}
	return kit.NoContent(w)
}

// workflowRuleRuns lists the rule's last 50 runs and its pending scheduled
// actions.
func (h *handler) workflowRuleRuns(w http.ResponseWriter, r *http.Request) error {
	id, err := h.settingsRule(r, "crm_workflow_rules", workflowRuleNotFound)
	if err != nil {
		return err
	}
	ctx := r.Context()
	runs, err := kit.Query(ctx, h.db, `SELECT id, subject_type, subject_id, status, actions_result, error, created_at
       FROM crm.crm_workflow_runs WHERE rule_id = $1::text::uuid ORDER BY created_at DESC LIMIT 50`, id)
	if err != nil {
		return err
	}
	scheduled, err := kit.Query(ctx, h.db, `SELECT id, subject_type, subject_id, run_at, status, attempts, last_error
       FROM crm.crm_scheduled_actions WHERE rule_id = $1::text::uuid AND status = 'pending' ORDER BY run_at LIMIT 50`, id)
	if err != nil {
		return err
	}
	return kit.OK(w, struct {
		Runs      []*kit.Row `json:"runs"`
		Scheduled []*kit.Row `json:"scheduled"`
	}{runs, scheduled})
}
