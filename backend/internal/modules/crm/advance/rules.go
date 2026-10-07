package advance

import (
	"context"
	"fmt"
	"net/http"
	"strings"

	"nuhabit/backend/internal/modules/crm/internal/kit"
	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
)

// The rule registry of lib/crm/advance-rules-server.ts: company visibility,
// row access checks and the shared partial UPDATE.

// ruleVisibility mirrors ruleVisibilityWhere: global rows plus the user's
// company (TRUE without a company scope).
func ruleVisibility(alias string, s *kit.Scope, args *[]any) string {
	if s == nil || s.CompanyID == nil || *s.CompanyID == "" {
		return "TRUE"
	}
	*args = append(*args, *s.CompanyID)
	return fmt.Sprintf("(%s.company_id IS NULL OR %s.company_id = $%d)", alias, alias, len(*args))
}

// settingsRule is the common prologue of the [id] routes:
// requireCrmScope("settings") then assertRuleAccess.
func (h *handler) settingsRule(r *http.Request, table, notFound string) (string, error) {
	u, s, err := h.guard.RequireScope(r, kit.GateSettings)
	if err != nil {
		return "", err
	}
	id := r.PathValue("id")
	return id, h.assertRuleAccess(r.Context(), table, id, u, s, notFound)
}

// assertRuleAccess is 404 when the row is missing or belongs to another
// company (super_admin sees every company).
func (h *handler) assertRuleAccess(ctx context.Context, table, id string, u *auth.User, s *kit.Scope, notFound string) error {
	var companyID *string
	err := h.db.QueryRow(ctx, `SELECT company_id::text FROM crm.`+table+` WHERE id = $1::text::uuid`, id).Scan(&companyID)
	if database.IsNoRows(err) {
		return httpx.NotFound(notFound)
	}
	if err != nil {
		return err
	}
	foreign := u.Role != "super_admin" && companyID != nil && s != nil && s.CompanyID != nil && *s.CompanyID != "" && *companyID != *s.CompanyID
	if foreign {
		return httpx.NotFound(notFound)
	}
	return nil
}

// patchRule mirrors patchRule: only the sent fields plus updated_at, json
// columns as jsonb; emptyToNull stores "" as NULL. No field is 400.
func (h *handler) patchRule(ctx context.Context, table, id string, cols patchCols, emptyToNull bool, returning string) (*kit.Row, error) {
	sets := []string{"updated_at = now()"}
	args := []any{}
	for _, c := range cols {
		v, cast := c.value, ""
		switch {
		case c.json:
			v, cast = jsonbText(v), "::text::jsonb"
		case emptyToNull:
			if s, ok := v.(*string); ok && s != nil && *s == "" {
				v = nil
			}
		}
		args = append(args, v)
		sets = append(sets, fmt.Sprintf("%s = $%d%s", c.name, len(args), cast))
	}
	if len(args) == 0 {
		return nil, httpx.BadRequest("Tidak ada field yang diubah")
	}
	args = append(args, id)
	return kit.QueryOne(ctx, h.db, fmt.Sprintf("UPDATE crm.%s SET %s WHERE id = $%d::text::uuid RETURNING %s",
		table, strings.Join(sets, ", "), len(args), returning), args...)
}

func (h *handler) deleteRule(ctx context.Context, table, id string) error {
	_, err := h.db.Exec(ctx, `DELETE FROM crm.`+table+` WHERE id = $1::text::uuid`, id)
	return err
}

// jsonbText is JSON.stringify(v) for a jsonb parameter, numbers in their
// JavaScript form (a JSON null stays the JSON text "null").
func jsonbText(v any) string {
	b, err := kit.MarshalNoEscape(v)
	if err != nil {
		return "null"
	}
	return string(kit.JSJSON(b))
}

/* ── approval rules ────────────────────────────────────────────────────── */

const approvalRuleNotFound = "Aturan tidak ditemukan"

func (h *handler) listApprovalRules(w http.ResponseWriter, r *http.Request) error {
	_, s, err := h.guard.RequireScope(r, kit.GateSettings)
	if err != nil {
		return err
	}
	args := []any{}
	rows, err := kit.Query(r.Context(), h.db, `SELECT r.id, r.company_id, r.object, r.name, r.level, r.min_discount_percent, r.approver_role,
            r.approver_user_id, u.full_name AS approver_name, r.is_active, r.created_at
     FROM crm.crm_approval_rules r LEFT JOIN configuration.users u ON u.id = r.approver_user_id
     WHERE `+ruleVisibility("r", s, &args)+` ORDER BY r.level, r.min_discount_percent`, args...)
	if err != nil {
		return err
	}
	return kit.OK(w, rows)
}

func (h *handler) createApprovalRule(w http.ResponseWriter, r *http.Request) error {
	u, s, err := h.guard.RequireScope(r, kit.GateSettings)
	if err != nil {
		return err
	}
	f, err := kit.Form(r)
	if err != nil {
		return err
	}
	in := parseApprovalRule(f, false)
	if err := f.Err("Validation failed"); err != nil {
		return err
	}
	row, err := kit.QueryOne(r.Context(), h.db, `INSERT INTO crm.crm_approval_rules (company_id, name, level, min_discount_percent, approver_role, approver_user_id, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, name, level, min_discount_percent`,
		kit.ScopedCompanyID(u, s), in.name, in.level, in.minDiscount, emptyNil(in.approverRole), emptyNil(in.approverUserID), in.isActive)
	if err != nil {
		return err
	}
	return kit.Created(w, row, "Aturan approval dibuat")
}

func (h *handler) patchApprovalRule(w http.ResponseWriter, r *http.Request) error {
	id, err := h.settingsRule(r, "crm_approval_rules", approvalRuleNotFound)
	if err != nil {
		return err
	}
	f, err := kit.Form(r)
	if err != nil {
		return err
	}
	in := parseApprovalRule(f, true)
	if err := f.Err("Validation failed"); err != nil {
		return err
	}
	row, err := h.patchRule(r.Context(), "crm_approval_rules", id, in.cols, true, "id, name, level, min_discount_percent, is_active")
	if err != nil {
		return err
	}
	return kit.OK(w, row, "Aturan diperbarui")
}

func (h *handler) deleteApprovalRule(w http.ResponseWriter, r *http.Request) error {
	id, err := h.settingsRule(r, "crm_approval_rules", approvalRuleNotFound)
	if err != nil {
		return err
	}
	if err := h.deleteRule(r.Context(), "crm_approval_rules", id); err != nil {
		return err
	}
	return kit.NoContent(w)
}

// emptyNil is `value || null` for an optional string.
func emptyNil(s *string) *string {
	if s == nil || *s == "" {
		return nil
	}
	return s
}

/* ── scoring rules ─────────────────────────────────────────────────────── */

const scoringRuleNotFound = "Aturan tidak ditemukan"

func (h *handler) listScoringRules(w http.ResponseWriter, r *http.Request) error {
	_, s, err := h.guard.RequireScope(r, kit.GateSettings)
	if err != nil {
		return err
	}
	args := []any{}
	rows, err := kit.Query(r.Context(), h.db, `SELECT r.id, r.company_id, r.name, r.kind, r.field, r.operator, r.value, r.event_type,
            r.window_days, r.max_count, r.points, r.is_active, r.sort_order, r.created_at, r.updated_at
     FROM crm.crm_scoring_rules r WHERE `+ruleVisibility("r", s, &args)+`
     ORDER BY r.sort_order, r.created_at`, args...)
	if err != nil {
		return err
	}
	return kit.OK(w, rows)
}

func (h *handler) createScoringRule(w http.ResponseWriter, r *http.Request) error {
	u, s, err := h.guard.RequireScope(r, kit.GateSettings)
	if err != nil {
		return err
	}
	f, err := kit.Form(r)
	if err != nil {
		return err
	}
	in := parseScoringRule(f, false)
	if err := f.Err("Validation failed"); err != nil {
		return err
	}
	var field, operator, eventType, value *string
	switch *in.kind {
	case "field":
		field, operator = in.field, in.operator
	case "event":
		eventType = in.eventType
	}
	if sent(f, "value") {
		v := jsonbText(in.value)
		value = &v
	}
	row, err := kit.QueryOne(r.Context(), h.db, `INSERT INTO crm.crm_scoring_rules
       (company_id, name, kind, field, operator, value, event_type, window_days, max_count, points, is_active, sort_order, created_by)
     VALUES ($1, $2, $3, $4, $5, $6::text::jsonb, $7, $8, $9, $10, $11, $12, $13)
     RETURNING id, name, kind, points, is_active`,
		kit.ScopedCompanyID(u, s), in.name, in.kind, field, operator, value, eventType, in.windowDays,
		in.maxCount, in.points, in.isActive, in.sortOrder, u.ID)
	if err != nil {
		return err
	}
	return kit.Created(w, row, "Aturan scoring dibuat")
}

func (h *handler) patchScoringRule(w http.ResponseWriter, r *http.Request) error {
	id, err := h.settingsRule(r, "crm_scoring_rules", scoringRuleNotFound)
	if err != nil {
		return err
	}
	f, err := kit.Form(r)
	if err != nil {
		return err
	}
	in := parseScoringRule(f, true)
	if err := f.Err("Validation failed"); err != nil {
		return err
	}
	row, err := h.patchRule(r.Context(), "crm_scoring_rules", id, in.cols, false, "id, name, points, is_active")
	if err != nil {
		return err
	}
	return kit.OK(w, row, "Aturan diperbarui")
}

func (h *handler) deleteScoringRule(w http.ResponseWriter, r *http.Request) error {
	id, err := h.settingsRule(r, "crm_scoring_rules", scoringRuleNotFound)
	if err != nil {
		return err
	}
	if err := h.deleteRule(r.Context(), "crm_scoring_rules", id); err != nil {
		return err
	}
	return kit.NoContent(w)
}

/* ── custom fields ─────────────────────────────────────────────────────── */

const customFieldNotFound = "Field tidak ditemukan"

func (h *handler) listCustomFields(w http.ResponseWriter, r *http.Request) error {
	_, s, err := h.guard.RequireScope(r, kit.GateSettings)
	if err != nil {
		return err
	}
	args := []any{}
	where := ruleVisibility("f", s, &args)
	if object := r.URL.Query().Get("object"); object != "" {
		args = append(args, object)
		where += fmt.Sprintf(" AND f.object = $%d", len(args))
	}
	rows, err := kit.Query(r.Context(), h.db, `SELECT f.id, f.company_id, f.object, f.key, f.label, f.field_type, f.options, f.is_required, f.validation,
            f.help_text, f.show_in_list, f.sort_order, f.is_active, f.created_at
     FROM crm.crm_custom_fields f WHERE `+where+` ORDER BY f.object, f.sort_order, f.created_at`, args...)
	if err != nil {
		return err
	}
	return kit.OK(w, rows)
}

func (h *handler) createCustomField(w http.ResponseWriter, r *http.Request) error {
	u, s, err := h.guard.RequireScope(r, kit.GateSettings)
	if err != nil {
		return err
	}
	f, err := kit.Form(r)
	if err != nil {
		return err
	}
	in := parseCustomField(f, false)
	if err := f.Err("Validation failed"); err != nil {
		return err
	}
	ctx := r.Context()
	companyID := kit.ScopedCompanyID(u, s)
	var dup string
	err = h.db.QueryRow(ctx, `SELECT id FROM crm.crm_custom_fields WHERE object = $1 AND key = $2 AND (company_id IS NULL OR company_id = $3)`,
		in.object, in.key, companyID).Scan(&dup)
	switch {
	case err == nil:
		return httpx.Conflict("Key sudah dipakai untuk objek ini")
	case !database.IsNoRows(err):
		return err
	}
	row, err := kit.QueryOne(ctx, h.db, `INSERT INTO crm.crm_custom_fields
       (company_id, object, key, label, field_type, options, is_required, validation, help_text, show_in_list, sort_order, is_active, created_by)
     VALUES ($1, $2, $3, $4, $5, $6::text::jsonb, $7, $8::text::jsonb, $9, $10, $11, $12, $13)
     RETURNING id, object, key, label, field_type`,
		companyID, in.object, in.key, in.label, in.fieldType, jsonbText(in.options), in.isRequired, jsonbText(in.validation),
		in.helpText, in.showInList, in.sortOrder, in.isActive, u.ID)
	if err != nil {
		return err
	}
	return kit.Created(w, row, "Custom field dibuat")
}

func (h *handler) patchCustomField(w http.ResponseWriter, r *http.Request) error {
	id, err := h.settingsRule(r, "crm_custom_fields", customFieldNotFound)
	if err != nil {
		return err
	}
	f, err := kit.Form(r)
	if err != nil {
		return err
	}
	in := parseCustomField(f, true)
	if err := f.Err("Validation failed"); err != nil {
		return err
	}
	row, err := h.patchRule(r.Context(), "crm_custom_fields", id, in.cols, false, "id, key, label, is_active")
	if err != nil {
		return err
	}
	return kit.OK(w, row, "Custom field diperbarui")
}

func (h *handler) deleteCustomField(w http.ResponseWriter, r *http.Request) error {
	id, err := h.settingsRule(r, "crm_custom_fields", customFieldNotFound)
	if err != nil {
		return err
	}
	// Stored values on records stay; only the definition goes.
	if err := h.deleteRule(r.Context(), "crm_custom_fields", id); err != nil {
		return err
	}
	return kit.NoContent(w)
}
