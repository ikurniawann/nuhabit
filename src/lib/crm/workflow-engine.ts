/**
 * EPIC-050 Fase 2 (T-2.3) — mesin workflow (sisi server).
 *
 * Alur: event masuk → cari aturan aktif (object+trigger) → muat snapshot record
 * → evaluasi kondisi → jalankan aksi berurutan; aksi setelah `wait` disimpan
 * ke crm_scheduled_actions dan dieksekusi watcher. Setiap eksekusi dicatat di
 * crm_workflow_runs (best-effort: satu aksi gagal tidak membatalkan yang lain).
 * Trigger berbasis waktu (inactive_days, due_soon) dievaluasi watcher lewat
 * scanTimeBasedRules().
 */
import { query, queryOne } from "@/lib/db";
import { loadGatewayConfig, sendGatewayText } from "@/lib/whatsapp/gateway";
import { isValidNormalizedPhone, normalizePhone } from "@/lib/sales-funnel/server";
import {
  evaluateConditions,
  pickRoundRobin,
  renderTemplate,
  splitAtWait,
  triggerForEvent,
  UPDATABLE_FIELDS,
  type RecordChanges,
  type RecordSnapshot,
  type WorkflowAction,
  type WorkflowCondition,
  type WorkflowObject,
  type WorkflowTrigger,
} from "./workflow";

export interface CrmEventInput {
  event_type: string;
  subject_type: WorkflowObject | "member";
  subject_id: string;
  company_id: string | null;
  branch_id: string | null;
  payload?: Record<string, unknown>;
  actor_user_id?: string | null;
  changes?: RecordChanges;
}

type RuleRow = {
  id: string;
  company_id: string | null;
  name: string;
  object: WorkflowObject;
  trigger_type: WorkflowTrigger;
  trigger_config: { days?: number; score?: number; to_stage?: string | null; to_status?: string | null };
  conditions: WorkflowCondition[];
  actions: WorkflowAction[];
  run_once_per_record: boolean;
  run_count: number;
};

export interface ActionContext {
  ruleId: string | null;
  runId: string | null;
  eventId: string | null;
  companyId: string | null;
  branchId: string | null;
  subjectType: WorkflowObject;
  subjectId: string;
  record: RecordSnapshot;
  template: Record<string, unknown>;
  actorUserId: string | null;
}

// ─────────────────────────────────────────────────────────────
// Snapshot record + konteks template
// ─────────────────────────────────────────────────────────────

const SNAPSHOT_SQL: Record<WorkflowObject, string> = {
  lead: `SELECT l.*, u.full_name AS owner_name, a.name AS account_name,
                (SELECT max(COALESCE(x.done_at, x.created_at)) FROM crm.crm_sales_activities x
                  WHERE x.deleted_at IS NULL AND (x.lead_id = l.id OR (x.subject_type='lead' AND x.subject_id = l.id))) AS last_activity_at
         FROM crm.crm_sales_leads l
         LEFT JOIN configuration.users u ON u.id = l.owner_user_id
         LEFT JOIN crm.crm_accounts a ON a.id = l.account_id
         WHERE l.id = $1 AND l.deleted_at IS NULL`,
  deal: `SELECT d.*, u.full_name AS owner_name, s.name AS stage_name, s.code AS stage_code,
                s.is_won, s.is_lost, l.org_name, l.pic_name, l.pic_phone, l.source, l.org_type,
                (SELECT max(COALESCE(x.done_at, x.created_at)) FROM crm.crm_sales_activities x
                  WHERE x.deleted_at IS NULL AND x.deal_id = d.id) AS last_activity_at
         FROM crm.crm_sales_deals d
         JOIN crm.crm_sales_leads l ON l.id = d.lead_id
         JOIN crm.crm_sales_stages s ON s.id = d.stage_id
         LEFT JOIN configuration.users u ON u.id = d.owner_user_id
         WHERE d.id = $1 AND d.deleted_at IS NULL`,
  account: `SELECT a.*, u.full_name AS owner_name
            FROM crm.crm_accounts a LEFT JOIN configuration.users u ON u.id = a.owner_user_id
            WHERE a.id = $1 AND a.deleted_at IS NULL`,
  contact: `SELECT c.*, u.full_name AS owner_name, a.name AS account_name
            FROM crm.crm_contacts c
            LEFT JOIN configuration.users u ON u.id = c.owner_user_id
            LEFT JOIN crm.crm_accounts a ON a.id = c.account_id
            WHERE c.id = $1 AND c.deleted_at IS NULL`,
  task: `SELECT t.*, u.full_name AS owner_name
         FROM crm.crm_sales_activities t LEFT JOIN configuration.users u ON u.id = t.owner_user_id
         WHERE t.id = $1 AND t.deleted_at IS NULL`,
  quotation: `SELECT q.*, d.title AS deal_title, d.owner_user_id, u.full_name AS owner_name,
                     l.org_name, l.pic_name, l.pic_phone
              FROM crm.crm_sales_quotations q
              JOIN crm.crm_sales_deals d ON d.id = q.deal_id
              JOIN crm.crm_sales_leads l ON l.id = d.lead_id
              LEFT JOIN configuration.users u ON u.id = d.owner_user_id
              WHERE q.id = $1 AND q.deleted_at IS NULL`,
};

export async function loadSnapshot(object: WorkflowObject, id: string): Promise<RecordSnapshot | null> {
  return queryOne<RecordSnapshot>(SNAPSHOT_SQL[object], [id]);
}

function buildTemplateContext(object: WorkflowObject, record: RecordSnapshot, payload: Record<string, unknown>) {
  const owner = { name: record.owner_name ?? "", id: record.owner_user_id ?? "" };
  const base: Record<string, unknown> = {
    owner,
    score: record.score ?? 0,
    stage: { name: record.stage_name ?? payload.to_stage_name ?? "", code: record.stage_code ?? "" },
    event: payload,
  };
  base[object] = record;
  if (object === "deal" || object === "quotation") {
    base.lead = { org_name: record.org_name, pic_name: record.pic_name, pic_phone: record.pic_phone, source: record.source };
  }
  return base;
}

// ─────────────────────────────────────────────────────────────
// Aksi
// ─────────────────────────────────────────────────────────────

async function ownerPhone(userId: string | null | undefined): Promise<string | null> {
  if (!userId) return null;
  const row = await queryOne<{ phone: string | null }>(
    `SELECT e.phone FROM hris.employees e WHERE e.user_id = $1 AND e.phone IS NOT NULL
     ORDER BY e.created_at DESC LIMIT 1`,
    [userId]
  );
  const phone = row?.phone ? normalizePhone(row.phone) : "";
  return isValidNormalizedPhone(phone) ? phone : null;
}

async function resolveUserIds(
  target: "owner" | "user" | "role",
  ctx: ActionContext,
  userId?: string | null,
  role?: string | null
): Promise<string[]> {
  if (target === "user" && userId) return [userId];
  if (target === "role" && role) {
    const rows = await query<{ id: string }>(
      `SELECT id FROM configuration.users
       WHERE role = $1 AND status = 'active' AND ($2::uuid IS NULL OR company_id IS NULL OR company_id = $2)
       LIMIT 50`,
      [role, ctx.companyId]
    );
    return rows.map((r) => r.id);
  }
  // owner = PJ record; bila belum ada PJ, jatuh ke pemicu event (mis. admin
  // yang membuat lead) supaya notifikasi tidak hilang.
  const owner = ctx.record.owner_user_id as string | null | undefined;
  if (owner) return [owner];
  return ctx.actorUserId ? [ctx.actorUserId] : [];
}

export async function notifyUsers(
  userIds: string[],
  title: string,
  message: string,
  link: string | null,
  metadata: Record<string, unknown> = {}
): Promise<number> {
  let n = 0;
  for (const uid of new Set(userIds)) {
    await query(
      `INSERT INTO public.notifications (user_id, title, message, type, link, metadata, is_read)
       VALUES ($1, $2, $3, 'alert', $4, $5::jsonb, false)`,
      [uid, title.slice(0, 150), message.slice(0, 1000), link, JSON.stringify(metadata)]
    );
    n += 1;
  }
  return n;
}

function subjectLink(object: WorkflowObject, id: string, record: RecordSnapshot): string {
  switch (object) {
    case "lead":
      return `/dashboard/sales-funnel/leads/${id}`;
    case "deal":
      return `/dashboard/sales-funnel/pipeline?deal=${id}`;
    case "account":
      return `/dashboard/sales-funnel/accounts/${id}`;
    case "contact":
      return `/dashboard/sales-funnel/contacts?q=${encodeURIComponent(String(record.phone ?? ""))}`;
    case "task":
      return `/dashboard/sales-funnel/tasks?task=${id}`;
    case "quotation":
      return `/dashboard/sales-funnel/pipeline?deal=${String(record.deal_id ?? "")}`;
  }
}

export async function executeAction(action: WorkflowAction, ctx: ActionContext): Promise<Record<string, unknown>> {
  const { record, subjectType, subjectId } = ctx;
  switch (action.type) {
    case "send_wa": {
      const config = await loadGatewayConfig();
      if (!config) return { type: action.type, ok: false, reason: "WA gateway belum dikonfigurasi" };
      let target: string | null = null;
      if (action.to === "number" && action.number) {
        const p = normalizePhone(action.number);
        target = isValidNormalizedPhone(p) ? p : null;
      } else if (action.to === "pic") {
        const raw = String(record.pic_phone ?? record.phone ?? "");
        const p = raw ? normalizePhone(raw) : "";
        target = isValidNormalizedPhone(p) ? p : null;
      } else {
        target = await ownerPhone(record.owner_user_id as string | null);
      }
      if (!target) return { type: action.type, ok: false, reason: "nomor tujuan tidak tersedia" };
      const message = renderTemplate(action.message, ctx.template);
      const result = await sendGatewayText(config, { target, message });
      return { type: action.type, ok: result.success, to: target, reason: result.success ? undefined : result.reason };
    }
    case "create_task": {
      let owner: string | null = null;
      if (action.assign_to === "owner") owner = (record.owner_user_id as string | null) ?? null;
      else if (action.assign_to === "creator") owner = ctx.actorUserId;
      else owner = action.assign_to;
      const due = new Date(Date.now() + (action.due_in_days ?? 1) * 86_400_000);
      due.setHours(9, 0, 0, 0);
      const leadId = subjectType === "lead" ? subjectId : subjectType === "deal" ? null : null;
      const dealId = subjectType === "deal" ? subjectId : null;
      const row = await queryOne<{ id: string }>(
        `INSERT INTO crm.crm_sales_activities
           (company_id, branch_id, lead_id, deal_id, subject_type, subject_id, activity_type, title, notes,
            due_at, reminder_at, status, priority, owner_user_id, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10, 'open', $11, $12, $13)
         RETURNING id`,
        [
          ctx.companyId ?? record.company_id,
          ctx.branchId ?? record.branch_id,
          leadId,
          dealId,
          subjectType === "task" ? record.subject_type : subjectType,
          subjectType === "task" ? record.subject_id : subjectId,
          action.activity_type,
          renderTemplate(action.title, ctx.template).slice(0, 200),
          action.notes ? renderTemplate(action.notes, ctx.template) : null,
          due.toISOString(),
          action.priority,
          owner,
          ctx.actorUserId,
        ]
      );
      return { type: action.type, ok: true, task_id: row?.id };
    }
    case "assign_owner": {
      if (action.only_if_empty && record.owner_user_id) return { type: action.type, ok: true, skipped: "sudah ada owner" };
      let userId: string | null = action.user_id ?? null;
      if (action.strategy === "round_robin" && action.user_ids?.length) {
        const prev = ctx.ruleId
          ? await queryOne<{ n: string }>(`SELECT count(*) AS n FROM crm.crm_workflow_runs WHERE rule_id = $1`, [ctx.ruleId])
          : null;
        userId = pickRoundRobin(action.user_ids, Number(prev?.n ?? 0));
      }
      if (!userId) return { type: action.type, ok: false, reason: "tidak ada kandidat owner" };
      const table = TABLE_BY_OBJECT[subjectType];
      if (!table) return { type: action.type, ok: false, reason: "objek tidak mendukung owner" };
      await query(`UPDATE ${table} SET owner_user_id = $2, updated_at = now() WHERE id = $1`, [subjectId, userId]);
      record.owner_user_id = userId;
      return { type: action.type, ok: true, owner_user_id: userId };
    }
    case "update_field": {
      if (!UPDATABLE_FIELDS[subjectType].includes(action.field)) {
        return { type: action.type, ok: false, reason: "field tidak diizinkan" };
      }
      const table = TABLE_BY_OBJECT[subjectType];
      await query(`UPDATE ${table} SET ${action.field} = $2, updated_at = now() WHERE id = $1`, [subjectId, action.value]);
      record[action.field] = action.value;
      return { type: action.type, ok: true, field: action.field };
    }
    case "notify_in_app": {
      const ids = await resolveUserIds(action.to, ctx, action.user_id, action.role);
      const n = await notifyUsers(
        ids,
        renderTemplate(action.title, ctx.template),
        renderTemplate(action.message, ctx.template),
        subjectLink(subjectType, subjectId, record),
        { rule_id: ctx.ruleId, subject_type: subjectType, subject_id: subjectId }
      );
      return { type: action.type, ok: n > 0, notified: n };
    }
    case "webhook": {
      const body = JSON.stringify({
        rule_id: ctx.ruleId,
        subject_type: subjectType,
        subject_id: subjectId,
        record,
        sent_at: new Date().toISOString(),
      });
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (action.secret) {
        const { createHmac } = await import("node:crypto");
        const signature = createHmac("sha256", action.secret).update(body).digest("hex");
        headers["X-NuHabit-Signature"] = signature;
        // Header lama tetap dikirim agar penerima yang sudah ada tidak putus.
        headers["X-BCDCoffee-Signature"] = signature;
      }
      const res = await fetch(action.url, { method: "POST", headers, body, signal: AbortSignal.timeout(10_000) });
      return { type: action.type, ok: res.ok, status: res.status };
    }
    case "wait":
      return { type: action.type, ok: true };
  }
}

const TABLE_BY_OBJECT: Record<WorkflowObject, string> = {
  lead: "crm.crm_sales_leads",
  deal: "crm.crm_sales_deals",
  account: "crm.crm_accounts",
  contact: "crm.crm_contacts",
  task: "crm.crm_sales_activities",
  quotation: "crm.crm_sales_quotations",
};

async function runActions(actions: WorkflowAction[], ctx: ActionContext): Promise<{ results: Record<string, unknown>[]; scheduledId: string | null; failed: number }> {
  const { now, later, delayMs } = splitAtWait(actions);
  const results: Record<string, unknown>[] = [];
  let failed = 0;
  for (const action of now) {
    try {
      const r = await executeAction(action, ctx);
      results.push(r);
      if (r.ok === false) failed += 1;
    } catch (err) {
      failed += 1;
      results.push({ type: action.type, ok: false, reason: err instanceof Error ? err.message : String(err) });
    }
  }
  let scheduledId: string | null = null;
  if (later.length > 0) {
    const row = await queryOne<{ id: string }>(
      `INSERT INTO crm.crm_scheduled_actions
         (rule_id, run_id, company_id, branch_id, subject_type, subject_id, actions, context, run_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9)
       RETURNING id`,
      [
        ctx.ruleId,
        ctx.runId,
        ctx.companyId,
        ctx.branchId,
        ctx.subjectType,
        ctx.subjectId,
        JSON.stringify(later),
        JSON.stringify({ actor_user_id: ctx.actorUserId, payload: ctx.template.event ?? {} }),
        new Date(Date.now() + delayMs).toISOString(),
      ]
    );
    scheduledId = row?.id ?? null;
  }
  return { results, scheduledId, failed };
}

// ─────────────────────────────────────────────────────────────
// Proses event
// ─────────────────────────────────────────────────────────────

async function matchingRules(object: WorkflowObject, trigger: WorkflowTrigger, companyId: string | null): Promise<RuleRow[]> {
  return query<RuleRow>(
    `SELECT id, company_id, name, object, trigger_type, trigger_config, conditions, actions,
            run_once_per_record, run_count
     FROM crm.crm_workflow_rules
     WHERE is_active AND object = $1 AND trigger_type = $2
       AND (company_id IS NULL OR company_id = $3)
     ORDER BY created_at`,
    [object, trigger, companyId]
  );
}

async function alreadyRan(ruleId: string, subjectId: string): Promise<boolean> {
  const row = await queryOne<{ id: string }>(
    `SELECT id FROM crm.crm_workflow_runs WHERE rule_id = $1 AND subject_id = $2 AND status <> 'skipped' LIMIT 1`,
    [ruleId, subjectId]
  );
  return Boolean(row);
}

export async function runRuleForSubject(
  rule: RuleRow,
  input: { object: WorkflowObject; subjectId: string; companyId: string | null; branchId: string | null; eventId: string | null; actorUserId: string | null; payload: Record<string, unknown>; changes: RecordChanges }
): Promise<void> {
  if (rule.run_once_per_record && (await alreadyRan(rule.id, input.subjectId))) return;
  const record = await loadSnapshot(input.object, input.subjectId);
  if (!record) return;

  // trigger_config spesifik
  const cfg = rule.trigger_config ?? {};
  if (rule.trigger_type === "stage_changed" && cfg.to_stage && String(record.stage_code ?? "") !== cfg.to_stage) return;
  if (rule.trigger_type === "status_changed" && cfg.to_status && String(record.status ?? "") !== cfg.to_status) return;
  if (rule.trigger_type === "score_reached" && typeof cfg.score === "number") {
    const score = Number(record.score ?? 0);
    const prev = Number(input.payload.previous_score ?? -Infinity);
    if (score < cfg.score || prev >= cfg.score) return; // hanya saat melewati ambang
  }
  if (!evaluateConditions(rule.conditions ?? [], record, input.changes)) {
    await query(
      `INSERT INTO crm.crm_workflow_runs (rule_id, event_id, subject_type, subject_id, status, actions_result)
       VALUES ($1, $2, $3, $4, 'skipped', '[]'::jsonb)`,
      [rule.id, input.eventId, input.object, input.subjectId]
    );
    return;
  }
  const run = await queryOne<{ id: string }>(
    `INSERT INTO crm.crm_workflow_runs (rule_id, event_id, subject_type, subject_id, status)
     VALUES ($1, $2, $3, $4, 'scheduled') RETURNING id`,
    [rule.id, input.eventId, input.object, input.subjectId]
  );
  const ctx: ActionContext = {
    ruleId: rule.id,
    runId: run?.id ?? null,
    eventId: input.eventId,
    companyId: input.companyId ?? (record.company_id as string | null) ?? null,
    branchId: input.branchId ?? (record.branch_id as string | null) ?? null,
    subjectType: input.object,
    subjectId: input.subjectId,
    record,
    template: buildTemplateContext(input.object, record, input.payload),
    actorUserId: input.actorUserId,
  };
  const { results, scheduledId, failed } = await runActions(rule.actions ?? [], ctx);
  const status = failed === 0 ? (scheduledId ? "scheduled" : "success") : failed === results.length ? "failed" : "partial";
  await query(
    `UPDATE crm.crm_workflow_runs SET status = $2, actions_result = $3::jsonb, error = $4 WHERE id = $1`,
    [run?.id, status, JSON.stringify(results), failed > 0 ? `${failed} aksi gagal` : null]
  );
  await query(`UPDATE crm.crm_workflow_rules SET run_count = run_count + 1, last_run_at = now() WHERE id = $1`, [rule.id]);
}

/** Dipanggil event bus: cari aturan yang cocok lalu jalankan. */
export async function processWorkflowEvent(event: CrmEventInput & { id: string | null }): Promise<void> {
  const mapped = triggerForEvent(event.event_type);
  if (!mapped) return;
  const rules = await matchingRules(mapped.object, mapped.trigger, event.company_id);
  for (const rule of rules) {
    try {
      await runRuleForSubject(rule, {
        object: mapped.object,
        subjectId: event.subject_id,
        companyId: event.company_id,
        branchId: event.branch_id,
        eventId: event.id,
        actorUserId: event.actor_user_id ?? null,
        payload: event.payload ?? {},
        changes: event.changes ?? {},
      });
    } catch (err) {
      console.error(`[crm-workflow] rule ${rule.name} gagal:`, err);
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Watcher: aksi terjadwal + trigger berbasis waktu
// ─────────────────────────────────────────────────────────────

export async function runDueScheduledActions(limit = 50): Promise<number> {
  const rows = await query<{
    id: string; rule_id: string | null; run_id: string | null; company_id: string | null; branch_id: string | null;
    subject_type: WorkflowObject; subject_id: string; actions: WorkflowAction[]; context: { actor_user_id?: string | null; payload?: Record<string, unknown> };
  }>(
    `UPDATE crm.crm_scheduled_actions SET attempts = attempts + 1, executed_at = now()
     WHERE id IN (SELECT id FROM crm.crm_scheduled_actions WHERE status = 'pending' AND run_at <= now()
                  ORDER BY run_at LIMIT $1 FOR UPDATE SKIP LOCKED)
     RETURNING id, rule_id, run_id, company_id, branch_id, subject_type, subject_id, actions, context`,
    [limit]
  );
  let done = 0;
  for (const row of rows) {
    try {
      const record = await loadSnapshot(row.subject_type, row.subject_id);
      if (!record) {
        await query(`UPDATE crm.crm_scheduled_actions SET status = 'cancelled', last_error = 'record tidak ada' WHERE id = $1`, [row.id]);
        continue;
      }
      const ctx: ActionContext = {
        ruleId: row.rule_id, runId: row.run_id, eventId: null,
        companyId: row.company_id, branchId: row.branch_id,
        subjectType: row.subject_type, subjectId: row.subject_id,
        record, template: buildTemplateContext(row.subject_type, record, row.context?.payload ?? {}),
        actorUserId: row.context?.actor_user_id ?? null,
      };
      const { results, failed } = await runActions(row.actions ?? [], ctx);
      await query(`UPDATE crm.crm_scheduled_actions SET status = $2, last_error = $3 WHERE id = $1`, [
        row.id, failed === 0 ? "done" : "failed", failed > 0 ? JSON.stringify(results).slice(0, 1000) : null,
      ]);
      if (row.run_id) {
        await query(`UPDATE crm.crm_workflow_runs SET status = $2, actions_result = actions_result || $3::jsonb WHERE id = $1`, [
          row.run_id, failed === 0 ? "success" : "partial", JSON.stringify(results),
        ]);
      }
      done += 1;
    } catch (err) {
      await query(`UPDATE crm.crm_scheduled_actions SET status = CASE WHEN attempts >= 3 THEN 'failed' ELSE 'pending' END, last_error = $2, run_at = now() + interval '10 minutes' WHERE id = $1`, [
        row.id, err instanceof Error ? err.message : String(err),
      ]);
    }
  }
  return done;
}

/**
 * inactive_days: lead/deal terbuka tanpa aktivitas ≥ N hari; due_soon: task/deal
 * dengan jatuh tempo/tanggal acara dalam N hari. Dijalankan tiap tick watcher;
 * run_once_per_record mencegah pengulangan (rekomendasi: biarkan true).
 */
export async function scanTimeBasedRules(): Promise<number> {
  const rules = await query<RuleRow>(
    `SELECT id, company_id, name, object, trigger_type, trigger_config, conditions, actions, run_once_per_record, run_count
     FROM crm.crm_workflow_rules WHERE is_active AND trigger_type IN ('inactive_days', 'due_soon')`
  );
  let triggered = 0;
  for (const rule of rules) {
    const days = Number(rule.trigger_config?.days ?? 0);
    if (!days) continue;
    let candidates: Array<{ id: string; company_id: string | null; branch_id: string | null }> = [];
    if (rule.trigger_type === "inactive_days" && rule.object === "lead") {
      candidates = await query(
        `SELECT l.id, l.company_id, l.branch_id FROM crm.crm_sales_leads l
         WHERE l.deleted_at IS NULL AND l.status IN ('baru', 'dihubungi', 'qualified')
           AND ($2::uuid IS NULL OR l.company_id = $2)
           AND COALESCE((SELECT max(COALESCE(x.done_at, x.created_at)) FROM crm.crm_sales_activities x
                         WHERE x.deleted_at IS NULL AND (x.lead_id = l.id OR (x.subject_type='lead' AND x.subject_id = l.id))), l.created_at)
               < now() - ($1::int * interval '1 day')
         LIMIT 200`,
        [days, rule.company_id]
      );
    } else if (rule.trigger_type === "inactive_days" && rule.object === "deal") {
      candidates = await query(
        `SELECT d.id, d.company_id, d.branch_id FROM crm.crm_sales_deals d
         WHERE d.deleted_at IS NULL AND d.closed_at IS NULL
           AND ($2::uuid IS NULL OR d.company_id = $2)
           AND COALESCE((SELECT max(COALESCE(x.done_at, x.created_at)) FROM crm.crm_sales_activities x
                         WHERE x.deleted_at IS NULL AND x.deal_id = d.id), d.entered_stage_at)
               < now() - ($1::int * interval '1 day')
         LIMIT 200`,
        [days, rule.company_id]
      );
    } else if (rule.trigger_type === "due_soon" && rule.object === "deal") {
      candidates = await query(
        `SELECT d.id, d.company_id, d.branch_id FROM crm.crm_sales_deals d
         WHERE d.deleted_at IS NULL AND d.closed_at IS NULL AND d.event_date IS NOT NULL
           AND ($2::uuid IS NULL OR d.company_id = $2)
           AND d.event_date BETWEEN CURRENT_DATE AND CURRENT_DATE + $1::int
         LIMIT 200`,
        [days, rule.company_id]
      );
    } else if (rule.trigger_type === "due_soon" && rule.object === "task") {
      candidates = await query(
        `SELECT t.id, t.company_id, t.branch_id FROM crm.crm_sales_activities t
         WHERE t.deleted_at IS NULL AND t.status IN ('open', 'in_progress') AND t.due_at IS NOT NULL
           AND ($2::uuid IS NULL OR t.company_id = $2)
           AND t.due_at BETWEEN now() AND now() + ($1::int * interval '1 day')
         LIMIT 200`,
        [days, rule.company_id]
      );
    } else if (rule.trigger_type === "due_soon" && rule.object === "quotation") {
      candidates = await query(
        `SELECT q.id, q.company_id, q.branch_id FROM crm.crm_sales_quotations q
         WHERE q.deleted_at IS NULL AND q.status IN ('draft', 'terkirim') AND q.valid_until IS NOT NULL
           AND ($2::uuid IS NULL OR q.company_id = $2)
           AND q.valid_until BETWEEN CURRENT_DATE AND CURRENT_DATE + $1::int
         LIMIT 200`,
        [days, rule.company_id]
      );
    }
    for (const c of candidates) {
      try {
        await runRuleForSubject(rule, {
          object: rule.object, subjectId: c.id, companyId: c.company_id, branchId: c.branch_id,
          eventId: null, actorUserId: null, payload: { days }, changes: {},
        });
        triggered += 1;
      } catch (err) {
        console.error(`[crm-workflow] time-based rule ${rule.name} gagal utk ${c.id}:`, err);
      }
    }
  }
  return triggered;
}
