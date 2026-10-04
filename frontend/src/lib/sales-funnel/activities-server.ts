import { ApiError } from "@/lib/api/auth";
import type { UserScope } from "@/lib/api/scope";
import { emitCrmEvent } from "@/lib/crm/events";
import { query, queryOne } from "@/lib/db";
import { requireAccessibleSubject } from "./access";
import {
  assertOwnerAssignable,
  requireSalesScope,
  requireSalesVenue,
  VENUE_MISSING_SHORT,
  type SalesFunnelUser,
} from "./server";
import { createUpdateSet, createWhere, isUuid } from "./sql";
import {
  DEFAULT_REMINDER_CHANNELS,
  TASK_PRIORITIES,
  TASK_STATUSES,
  TASK_SUBJECT_TYPES,
  isTaskOpen,
  recurrenceSchema,
  resolveTaskStatus,
  resolveTaskSubject,
  spawnNextTask,
  type CreateTaskInput,
  type TaskStatus,
  type TaskSubjectType,
  type UpdateTaskInput,
} from "./tasks";

/**
 * EPIC-050 Fase 1: aktivitas = task. Kolom lama (lead_id/deal_id/done_at)
 * tetap dikembalikan untuk klien lama; subject_name diresolusi per jenis
 * subjek untuk tampilan agenda/kalender.
 */
const ACTIVITY_COLUMNS = `
  a.id, a.lead_id, a.deal_id, a.subject_type, a.subject_id, a.activity_type,
  a.title, a.notes, a.due_at, a.done_at, a.status, a.priority, a.recurrence,
  a.reminder_at, a.reminder_channels, a.parent_task_id,
  a.owner_user_id, a.reminder_sent_at, a.created_at,
  u.full_name AS owner_name,
  d.title AS deal_title,
  COALESCE(dl.org_name, l.org_name, acc.name, con_acc.name, cust.name) AS org_name,
  COALESCE(dl.pic_name, l.pic_name, con.name, cust.name) AS pic_name,
  COALESCE(dl.pic_phone, l.pic_phone, con.phone, cust.phone) AS pic_phone,
  CASE a.subject_type
    WHEN 'deal' THEN d.title
    WHEN 'lead' THEN l.org_name
    WHEN 'account' THEN acc.name
    WHEN 'contact' THEN con.name
    WHEN 'member' THEN cust.name
    ELSE COALESCE(d.title, l.org_name)
  END AS subject_name`;

const ACTIVITY_JOINS = `
  FROM crm.crm_sales_activities a
  LEFT JOIN configuration.users u ON u.id = a.owner_user_id
  LEFT JOIN crm.crm_sales_deals d ON d.id = a.deal_id
  LEFT JOIN crm.crm_sales_leads dl ON dl.id = d.lead_id
  LEFT JOIN crm.crm_sales_leads l ON l.id = a.lead_id
  LEFT JOIN crm.crm_accounts acc ON a.subject_type = 'account' AND acc.id = a.subject_id
  LEFT JOIN crm.crm_contacts con ON a.subject_type = 'contact' AND con.id = a.subject_id
  LEFT JOIN crm.crm_accounts con_acc ON con_acc.id = con.account_id
  LEFT JOIN pos.pos_customers cust ON a.subject_type = 'member' AND cust.id = a.subject_id`;

// Agenda tidak dipaginasi (list harian/kalender) — pagar sama dengan kanban deals
const MAX_AGENDA_ROWS = 500;

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
}

/** Subjek timeline dari query string (deal_id/lead_id lama atau subject_type+subject_id). */
export function subjectFromSearchParams(searchParams: URLSearchParams) {
  const subjectType = searchParams.get("subject_type") ?? "";
  const subjectId = searchParams.get("subject_id");
  return resolveTaskSubject({
    deal_id: searchParams.get("deal_id"),
    lead_id: searchParams.get("lead_id"),
    subject_type: TASK_SUBJECT_TYPES.find((t) => t === subjectType),
    subject_id: isUuid(subjectId) ? subjectId : null,
  });
}

/** Task satu subjek — akses sudah dicek lewat induknya. */
export async function listSubjectActivities(subject: { subject_type: TaskSubjectType; subject_id: string }) {
  // lead/deal: kolom lama; account/contact/member: subject_*
  const where =
    subject.subject_type === "deal"
      ? "a.deal_id = $1"
      : subject.subject_type === "lead"
        ? "(a.lead_id = $1 OR (a.subject_type = 'lead' AND a.subject_id = $1))"
        : "(a.subject_type = $2 AND a.subject_id = $1)";
  return query(
    `SELECT ${ACTIVITY_COLUMNS} ${ACTIVITY_JOINS}
     WHERE a.deleted_at IS NULL AND ${where}
     ORDER BY COALESCE(a.due_at, a.created_at) DESC
     LIMIT ${MAX_AGENDA_ROWS}`,
    subject.subject_type === "deal" || subject.subject_type === "lead"
      ? [subject.subject_id]
      : [subject.subject_id, subject.subject_type]
  );
}

/** Agenda / kalender: scope bisnis + kepemilikan, filter status/prioritas/rentang. */
export async function listAgenda(user: SalesFunnelUser, scope: UserScope | null, searchParams: URLSearchParams) {
  const view = searchParams.get("view") ?? "";
  const status = searchParams.get("status") ?? "";
  const priority = searchParams.get("priority") ?? "";
  const owner = searchParams.get("owner_user_id");
  const from = searchParams.get("from") ?? "";
  const to = searchParams.get("to") ?? "";

  const where = createWhere(["a.deleted_at IS NULL"]);
  if (scope?.companyId) where.add("a.company_id = ?", scope.companyId);
  if (scope?.businessScope === "branch" && scope.branchId) where.add("a.branch_id = ?", scope.branchId);
  // Role sales hanya melihat agenda miliknya ATAU tanpa penanggung jawab
  if (user.role === "sales") where.add("(a.owner_user_id = ? OR a.owner_user_id IS NULL)", user.id);
  if (isUuid(owner)) where.add("a.owner_user_id = ?", owner);
  if ((TASK_STATUSES as readonly string[]).includes(status)) {
    where.add("a.status = ?", status);
  } else if (status === "open_all") {
    where.push("a.status IN ('open', 'in_progress')");
  }
  if ((TASK_PRIORITIES as readonly string[]).includes(priority)) where.add("a.priority = ?", priority);

  if (view === "today") {
    // Belum selesai & jatuh tempo s/d akhir hari ini (termasuk terlambat)
    where.push("a.status IN ('open', 'in_progress')");
    where.push("a.due_at IS NOT NULL");
    where.push("a.due_at < (CURRENT_DATE + 1)::timestamptz");
  } else if (view === "upcoming") {
    where.push("a.status IN ('open', 'in_progress')");
    where.push("(a.due_at IS NULL OR a.due_at >= (CURRENT_DATE + 1)::timestamptz)");
  } else if (view === "range") {
    if (!isIsoDate(from) || !isIsoDate(to)) {
      throw ApiError.badRequest("view=range membutuhkan from & to (YYYY-MM-DD)");
    }
    where.add("a.due_at >= ?::date::timestamptz", from);
    where.add("a.due_at < (?::date + 1)::timestamptz", to);
  }

  return query(
    `SELECT ${ACTIVITY_COLUMNS} ${ACTIVITY_JOINS}
     WHERE ${where.sql()}
     ORDER BY a.due_at ASC NULLS LAST,
              CASE a.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
              a.created_at DESC
     LIMIT ${MAX_AGENDA_ROWS}`,
    where.params
  );
}

export async function createActivity(user: SalesFunnelUser, body: CreateTaskInput) {
  const subject = resolveTaskSubject(body);
  if (!subject) {
    throw ApiError.badRequest("Task harus terkait lead, deal, account, contact, atau member");
  }
  // Task mewarisi venue dari subjeknya; member (global) memakai venue user
  const { venue } = await requireAccessibleSubject(subject.subject_type, subject.subject_id, user);
  const { companyId, branchId } = venue
    ? { companyId: venue.company_id, branchId: venue.branch_id }
    : await requireSalesVenue(await requireSalesScope(user), VENUE_MISSING_SHORT);
  await assertOwnerAssignable(user, body.owner_user_id, companyId);

  const status = resolveTaskStatus(body) ?? "open";
  const row = await queryOne<{ id: string }>(
    `INSERT INTO crm.crm_sales_activities
       (company_id, branch_id, lead_id, deal_id, subject_type, subject_id,
        activity_type, title, notes, due_at, done_at, status, priority,
        recurrence, reminder_at, reminder_channels, owner_user_id, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
             $14, $15, $16::jsonb, $17, $18)
     RETURNING id, activity_type, title, due_at, done_at, status, priority`,
    [
      companyId,
      branchId,
      subject.subject_type === "lead" ? subject.subject_id : null,
      subject.subject_type === "deal" ? subject.subject_id : null,
      subject.subject_type,
      subject.subject_id,
      body.activity_type,
      body.title || null,
      body.notes || null,
      body.due_at ?? null,
      status === "done" ? new Date().toISOString() : null,
      status,
      body.priority,
      body.recurrence ? JSON.stringify(body.recurrence) : null,
      body.reminder_at ?? body.due_at ?? null,
      JSON.stringify(body.reminder_channels ?? DEFAULT_REMINDER_CHANNELS),
      body.owner_user_id || (user.role === "sales" ? user.id : null),
      user.id,
    ]
  );
  // EPIC-050 Fase 2: event bus (task selesai saat dibuat = task.done)
  await emitCrmEvent({
    event_type: status === "done" ? "task.done" : "task.created",
    subject_type: "task",
    subject_id: String(row?.id),
    company_id: companyId,
    branch_id: branchId,
    actor_user_id: user.id,
    payload: { activity_type: body.activity_type, subject_type: subject.subject_type, subject_id: subject.subject_id },
  });
  return row;
}

type TaskRow = {
  id: string;
  company_id: string;
  branch_id: string;
  lead_id: string | null;
  deal_id: string | null;
  subject_type: string | null;
  subject_id: string | null;
  activity_type: string;
  title: string | null;
  notes: string | null;
  due_at: string | null;
  reminder_at: string | null;
  reminder_channels: unknown;
  status: string;
  priority: string;
  recurrence: unknown;
  owner_user_id: string | null;
  parent_task_id: string | null;
  created_by: string | null;
};

/**
 * Task berulang yang diselesaikan → kemunculan berikutnya (EPIC-050 T-1.5).
 * Tautan seri lewat parent_task_id (root seri). Idempoten: tidak membuat
 * duplikat bila kemunculan berikutnya (due sama, root sama) sudah ada.
 */
async function spawnRecurringSuccessor(task: TaskRow): Promise<string | null> {
  const parsed = recurrenceSchema.safeParse(task.recurrence);
  if (!parsed.success || !task.due_at) return null;
  const next = spawnNextTask({ due_at: task.due_at, reminder_at: task.reminder_at, recurrence: parsed.data });
  if (!next) return null;
  const rootId = task.parent_task_id ?? task.id;
  const existing = await queryOne<{ id: string }>(
    `SELECT id FROM crm.crm_sales_activities
     WHERE deleted_at IS NULL AND (parent_task_id = $1 OR id = $1)
       AND due_at = $2 LIMIT 1`,
    [rootId, next.due_at.toISOString()]
  );
  if (existing) return existing.id;
  const row = await queryOne<{ id: string }>(
    `INSERT INTO crm.crm_sales_activities
       (company_id, branch_id, lead_id, deal_id, subject_type, subject_id,
        activity_type, title, notes, due_at, status, priority, recurrence,
        reminder_at, reminder_channels, owner_user_id, parent_task_id, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'open', $11, $12::jsonb,
             $13, $14::jsonb, $15, $16, $17)
     RETURNING id`,
    [
      task.company_id,
      task.branch_id,
      task.lead_id,
      task.deal_id,
      task.subject_type,
      task.subject_id,
      task.activity_type,
      task.title,
      task.notes,
      next.due_at.toISOString(),
      task.priority,
      JSON.stringify(parsed.data),
      next.reminder_at ? next.reminder_at.toISOString() : null,
      JSON.stringify(task.reminder_channels ?? DEFAULT_REMINDER_CHANNELS),
      task.owner_user_id,
      rootId,
      task.created_by,
    ]
  );
  return row?.id ?? null;
}

export async function updateActivity(
  user: SalesFunnelUser,
  activity: { id: string; company_id: string },
  body: UpdateTaskInput
): Promise<Partial<TaskRow> & { next_task_id: string | null }> {
  const { is_done, status: statusInput, recurrence, reminder_channels, owner_user_id, ...fields } = body;
  await assertOwnerAssignable(user, owner_user_id, activity.company_id);

  const update = createUpdateSet();
  update.setAll(fields);
  if (owner_user_id !== undefined) update.set("owner_user_id", owner_user_id);
  if (recurrence !== undefined) update.set("recurrence", recurrence ? JSON.stringify(recurrence) : null, "::jsonb");
  if (reminder_channels !== undefined) update.set("reminder_channels", JSON.stringify(reminder_channels), "::jsonb");
  // Reminder yang dimajukan/dimundurkan boleh dikirim ulang
  if (fields.reminder_at !== undefined || fields.due_at !== undefined) {
    update.raw("reminder_sent_at = NULL");
    update.raw("in_app_notified_at = NULL");
  }
  const status = resolveTaskStatus({ status: statusInput, is_done });
  if (status) {
    update.set("status", status);
    update.set("done_at", status === "done" ? new Date().toISOString() : null);
  }
  const { sql, values, idParam } = update.build(activity.id);
  const row = await queryOne<TaskRow>(
    `UPDATE crm.crm_sales_activities SET ${sql}
     WHERE id = ${idParam}
     RETURNING id, company_id, branch_id, lead_id, deal_id, subject_type,
               subject_id, activity_type, title, notes, due_at, reminder_at,
               reminder_channels, status, priority, recurrence, owner_user_id,
               parent_task_id, created_by, done_at`,
    values
  );
  if (!row) return { next_task_id: null };

  const nextTaskId =
    status === "done" && row.recurrence && !isTaskOpen(row.status as TaskStatus)
      ? await spawnRecurringSuccessor(row)
      : null;
  // EPIC-050 Fase 2: event bus
  await emitCrmEvent({
    event_type: status === "done" ? "task.done" : "task.updated",
    subject_type: "task",
    subject_id: activity.id,
    company_id: row.company_id,
    branch_id: row.branch_id,
    actor_user_id: user.id,
    payload: { activity_type: row.activity_type, status: row.status, subject_type: row.subject_type, subject_id: row.subject_id },
  });
  return { ...row, next_task_id: nextTaskId };
}

export async function deleteActivity(id: string): Promise<void> {
  await query(`UPDATE crm.crm_sales_activities SET deleted_at = now(), updated_at = now() WHERE id = $1`, [id]);
}
