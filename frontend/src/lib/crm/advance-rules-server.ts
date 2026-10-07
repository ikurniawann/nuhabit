import "server-only";
/**
 * EPIC-050 — registry aturan CRM Advance (scoring, workflow, approval, custom
 * field): visibilitas per company, cek akses baris, dan CRUD SQL-nya.
 */
import { ApiError, type ApiUser } from "@/lib/api/auth";
import type { UserScope } from "@/lib/api/scope";
import { query, queryOne } from "@/lib/db";
import type { ApprovalRuleInput } from "./approvals";
import type { CustomFieldInput } from "./custom-fields";
import { scopedCompanyId } from "./guards";
import type { ScoringRuleInput } from "./scoring";
import type { WorkflowRuleInput } from "./workflow";

type RuleTable = "crm_scoring_rules" | "crm_workflow_rules" | "crm_approval_rules" | "crm_custom_fields";

/** Filter baris aturan yang boleh dilihat: global + company user (TRUE bila tanpa scope). */
export function ruleVisibilityWhere(alias: string, scope: UserScope | null, params: unknown[]): string {
  if (!scope?.companyId) return "TRUE";
  params.push(scope.companyId);
  return `(${alias}.company_id IS NULL OR ${alias}.company_id = $${params.length})`;
}

/** 404 bila baris tak ada atau milik company lain (super_admin boleh semua). */
export async function assertRuleAccess(
  table: RuleTable,
  id: string,
  user: ApiUser,
  scope: UserScope | null,
  notFoundMessage: string
): Promise<void> {
  const row = await queryOne<{ company_id: string | null }>(`SELECT company_id FROM crm.${table} WHERE id = $1`, [id]);
  const foreign =
    row && user.role !== "super_admin" && row.company_id && scope?.companyId && row.company_id !== scope.companyId;
  if (!row || foreign) throw ApiError.notFound(notFoundMessage);
}

/**
 * UPDATE parsial: hanya field terdefinisi; kolom `jsonKeys` disimpan sebagai
 * jsonb. Tanpa field → 400 "Tidak ada field yang diubah".
 */
async function patchRule(
  table: RuleTable,
  id: string,
  patch: Record<string, unknown>,
  options: { jsonKeys?: string[]; emptyToNull?: boolean; returning: string }
) {
  const sets: string[] = ["updated_at = now()"];
  const values: unknown[] = [];
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    const isJson = options.jsonKeys?.includes(key) ?? false;
    values.push(isJson ? JSON.stringify(value) : options.emptyToNull && value === "" ? null : value);
    sets.push(`${key} = $${values.length}${isJson ? "::jsonb" : ""}`);
  }
  if (values.length === 0) throw ApiError.badRequest("Tidak ada field yang diubah");
  values.push(id);
  return queryOne(
    `UPDATE crm.${table} SET ${sets.join(", ")} WHERE id = $${values.length} RETURNING ${options.returning}`,
    values
  );
}

export async function deleteRule(table: RuleTable, id: string): Promise<void> {
  await query(`DELETE FROM crm.${table} WHERE id = $1`, [id]);
}

// ── Scoring ────────────────────────────────────────────────────────────────

export function listScoringRules(scope: UserScope | null) {
  const params: unknown[] = [];
  return query(
    `SELECT r.id, r.company_id, r.name, r.kind, r.field, r.operator, r.value, r.event_type,
            r.window_days, r.max_count, r.points, r.is_active, r.sort_order, r.created_at, r.updated_at
     FROM crm.crm_scoring_rules r WHERE ${ruleVisibilityWhere("r", scope, params)}
     ORDER BY r.sort_order, r.created_at`,
    params
  );
}

export function createScoringRule(user: ApiUser, scope: UserScope | null, b: ScoringRuleInput) {
  return queryOne(
    `INSERT INTO crm.crm_scoring_rules
       (company_id, name, kind, field, operator, value, event_type, window_days, max_count, points, is_active, sort_order, created_by)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11, $12, $13)
     RETURNING id, name, kind, points, is_active`,
    [
      scopedCompanyId(user, scope), b.name, b.kind,
      b.kind === "field" ? b.field : null, b.kind === "field" ? b.operator : null,
      b.value === undefined ? null : JSON.stringify(b.value),
      b.kind === "event" ? b.event_type : null, b.window_days ?? null, b.max_count, b.points, b.is_active, b.sort_order, user.id,
    ]
  );
}

export function updateScoringRule(id: string, patch: Partial<ScoringRuleInput>) {
  return patchRule("crm_scoring_rules", id, patch, { jsonKeys: ["value"], returning: "id, name, points, is_active" });
}

// ── Workflow ───────────────────────────────────────────────────────────────

export function listWorkflowRules(scope: UserScope | null) {
  const params: unknown[] = [];
  return query(
    `SELECT r.id, r.company_id, r.name, r.description, r.object, r.trigger_type, r.trigger_config,
            r.conditions, r.actions, r.run_once_per_record, r.is_active, r.last_run_at, r.run_count, r.created_at, r.updated_at
     FROM crm.crm_workflow_rules r WHERE ${ruleVisibilityWhere("r", scope, params)} ORDER BY r.created_at DESC`,
    params
  );
}

function workflowValues(b: WorkflowRuleInput) {
  return [
    b.name, b.description ?? null, b.object, b.trigger_type, JSON.stringify(b.trigger_config ?? {}),
    JSON.stringify(b.conditions ?? []), JSON.stringify(b.actions), b.run_once_per_record, b.is_active,
  ];
}

export function createWorkflowRule(user: ApiUser, scope: UserScope | null, b: WorkflowRuleInput) {
  return queryOne(
    `INSERT INTO crm.crm_workflow_rules
       (company_id, name, description, object, trigger_type, trigger_config, conditions, actions, run_once_per_record, is_active, created_by)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, $9, $10, $11)
     RETURNING id, name, object, trigger_type, is_active`,
    [scopedCompanyId(user, scope), ...workflowValues(b), user.id]
  );
}

export function replaceWorkflowRule(id: string, b: WorkflowRuleInput) {
  return queryOne(
    `UPDATE crm.crm_workflow_rules
     SET name = $2, description = $3, object = $4, trigger_type = $5, trigger_config = $6::jsonb,
         conditions = $7::jsonb, actions = $8::jsonb, run_once_per_record = $9, is_active = $10, updated_at = now()
     WHERE id = $1 RETURNING id, name, object, trigger_type, is_active`,
    [id, ...workflowValues(b)]
  );
}

export function setWorkflowRuleActive(id: string, isActive: boolean) {
  return queryOne(
    `UPDATE crm.crm_workflow_rules SET is_active = $2, updated_at = now() WHERE id = $1 RETURNING id, is_active`,
    [id, isActive]
  );
}

export function getWorkflowRule(id: string) {
  return queryOne(`SELECT * FROM crm.crm_workflow_rules WHERE id = $1`, [id]);
}

/** Log eksekusi satu rule (50 terakhir) + aksi terjadwal yang masih menunggu. */
export async function listWorkflowRuleRuns(id: string) {
  const [runs, scheduled] = await Promise.all([
    query(
      `SELECT id, subject_type, subject_id, status, actions_result, error, created_at
       FROM crm.crm_workflow_runs WHERE rule_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [id]
    ),
    query(
      `SELECT id, subject_type, subject_id, run_at, status, attempts, last_error
       FROM crm.crm_scheduled_actions WHERE rule_id = $1 AND status = 'pending' ORDER BY run_at LIMIT 50`,
      [id]
    ),
  ]);
  return { runs, scheduled };
}

// ── Approval ───────────────────────────────────────────────────────────────

export function listApprovalRules(scope: UserScope | null) {
  const params: unknown[] = [];
  return query(
    `SELECT r.id, r.company_id, r.object, r.name, r.level, r.min_discount_percent, r.approver_role,
            r.approver_user_id, u.full_name AS approver_name, r.is_active, r.created_at
     FROM crm.crm_approval_rules r LEFT JOIN configuration.users u ON u.id = r.approver_user_id
     WHERE ${ruleVisibilityWhere("r", scope, params)} ORDER BY r.level, r.min_discount_percent`,
    params
  );
}

export function createApprovalRule(user: ApiUser, scope: UserScope | null, b: ApprovalRuleInput) {
  return queryOne(
    `INSERT INTO crm.crm_approval_rules (company_id, name, level, min_discount_percent, approver_role, approver_user_id, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, name, level, min_discount_percent`,
    [scopedCompanyId(user, scope), b.name, b.level, b.min_discount_percent, b.approver_role || null, b.approver_user_id || null, b.is_active]
  );
}

export function updateApprovalRule(id: string, patch: Partial<ApprovalRuleInput>) {
  return patchRule("crm_approval_rules", id, patch, {
    emptyToNull: true,
    returning: "id, name, level, min_discount_percent, is_active",
  });
}

// ── Custom field ───────────────────────────────────────────────────────────

export function listCustomFields(scope: UserScope | null, object: string | null) {
  const params: unknown[] = [];
  const where = ruleVisibilityWhere("f", scope, params);
  let objectWhere = "";
  if (object) {
    params.push(object);
    objectWhere = ` AND f.object = $${params.length}`;
  }
  return query(
    `SELECT f.id, f.company_id, f.object, f.key, f.label, f.field_type, f.options, f.is_required, f.validation,
            f.help_text, f.show_in_list, f.sort_order, f.is_active, f.created_at
     FROM crm.crm_custom_fields f WHERE ${where}${objectWhere} ORDER BY f.object, f.sort_order, f.created_at`,
    params
  );
}

export async function createCustomField(user: ApiUser, scope: UserScope | null, b: CustomFieldInput) {
  const companyId = scopedCompanyId(user, scope);
  const dup = await queryOne<{ id: string }>(
    `SELECT id FROM crm.crm_custom_fields WHERE object = $1 AND key = $2 AND (company_id IS NULL OR company_id = $3)`,
    [b.object, b.key, companyId]
  );
  if (dup) throw ApiError.conflict("Key sudah dipakai untuk objek ini");
  return queryOne(
    `INSERT INTO crm.crm_custom_fields
       (company_id, object, key, label, field_type, options, is_required, validation, help_text, show_in_list, sort_order, is_active, created_by)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8::jsonb, $9, $10, $11, $12, $13)
     RETURNING id, object, key, label, field_type`,
    [companyId, b.object, b.key, b.label, b.field_type, JSON.stringify(b.options), b.is_required, JSON.stringify(b.validation),
     b.help_text ?? null, b.show_in_list, b.sort_order, b.is_active, user.id]
  );
}

export function updateCustomField(id: string, patch: Partial<CustomFieldInput>) {
  return patchRule("crm_custom_fields", id, patch, {
    jsonKeys: ["options", "validation"],
    returning: "id, key, label, is_active",
  });
}
