/**
 * EPIC-050 Fase 2 (T-2.3) — workflow automation, bagian murni:
 * skema aturan, evaluator kondisi, render template pesan, pemetaan event → trigger.
 * Eksekusi aksi (DB/WA/webhook) ada di workflow-engine.ts.
 */
import { formatNumber } from "@/lib/format";
import { z } from "zod";

export const WORKFLOW_OBJECTS = ["lead", "deal", "account", "contact", "task", "quotation"] as const;
export type WorkflowObject = (typeof WORKFLOW_OBJECTS)[number];

export const WORKFLOW_TRIGGERS = [
  "created",
  "updated",
  "stage_changed",
  "status_changed",
  "score_reached",
  "inactive_days",
  "due_soon",
] as const;
export type WorkflowTrigger = (typeof WORKFLOW_TRIGGERS)[number];

export const CONDITION_OPS = [
  "eq",
  "neq",
  "in",
  "not_in",
  "contains",
  "gt",
  "gte",
  "lt",
  "lte",
  "is_empty",
  "not_empty",
  "changed",
  "changed_to",
] as const;
export type ConditionOp = (typeof CONDITION_OPS)[number];

export const conditionSchema = z.object({
  field: z.string().trim().min(1).max(60),
  op: z.enum(CONDITION_OPS),
  value: z.unknown().optional().nullable(),
});
export type WorkflowCondition = z.infer<typeof conditionSchema>;

/** Field yang boleh diubah aksi update_field, per objek (whitelist keamanan). */
export const UPDATABLE_FIELDS: Record<WorkflowObject, readonly string[]> = {
  lead: ["temperature", "status", "source", "notes", "city"],
  deal: ["event_type", "pax_estimate", "is_event_date_fixed"],
  account: ["account_type", "industry", "city", "notes"],
  contact: ["title", "notes"],
  task: ["priority", "status", "notes"],
  quotation: ["notes"],
};

const sendWaAction = z.object({
  type: z.literal("send_wa"),
  /** owner = penanggung jawab record; pic = PIC/contact; number = nomor eksplisit */
  to: z.enum(["owner", "pic", "number"]).default("owner"),
  number: z.string().trim().max(30).optional().nullable(),
  message: z.string().trim().min(1).max(2000),
});
const createTaskAction = z.object({
  type: z.literal("create_task"),
  title: z.string().trim().min(1).max(200),
  activity_type: z.enum(["tugas", "telepon", "wa", "meeting", "email", "catatan"]).default("tugas"),
  notes: z.string().trim().max(2000).optional().nullable(),
  due_in_days: z.number().min(0).max(365).default(1),
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
  /** owner = PJ record; creator = pemicu event; user_id eksplisit */
  assign_to: z.string().trim().max(60).default("owner"),
});
const assignOwnerAction = z.object({
  type: z.literal("assign_owner"),
  /** user_id tunggal ATAU round_robin dari daftar */
  user_id: z.string().uuid().optional().nullable(),
  strategy: z.enum(["fixed", "round_robin"]).default("fixed"),
  user_ids: z.array(z.string().uuid()).max(20).optional(),
  /** hanya isi bila record belum punya owner */
  only_if_empty: z.boolean().default(true),
});
const updateFieldAction = z.object({
  type: z.literal("update_field"),
  field: z.string().trim().min(1).max(60),
  value: z.unknown().nullable(),
});
const notifyAction = z.object({
  type: z.literal("notify_in_app"),
  to: z.enum(["owner", "user", "role"]).default("owner"),
  user_id: z.string().uuid().optional().nullable(),
  role: z.string().trim().max(40).optional().nullable(),
  title: z.string().trim().min(1).max(150),
  message: z.string().trim().min(1).max(1000),
});
const webhookAction = z.object({
  type: z.literal("webhook"),
  url: z.string().url().max(500),
  secret: z.string().max(200).optional().nullable(),
});
const waitAction = z.object({
  type: z.literal("wait"),
  hours: z.number().min(0).max(24 * 90).default(0),
  days: z.number().min(0).max(90).default(0),
});

export const actionSchema = z.discriminatedUnion("type", [
  sendWaAction,
  createTaskAction,
  assignOwnerAction,
  updateFieldAction,
  notifyAction,
  webhookAction,
  waitAction,
]);
export type WorkflowAction = z.infer<typeof actionSchema>;

export const workflowRuleSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(1000).optional().nullable(),
    object: z.enum(WORKFLOW_OBJECTS),
    trigger_type: z.enum(WORKFLOW_TRIGGERS),
    trigger_config: z
      .object({
        days: z.number().int().min(1).max(365).optional(),
        score: z.number().int().optional(),
        to_stage: z.string().trim().max(40).optional().nullable(),
        to_status: z.string().trim().max(40).optional().nullable(),
      })
      .default({}),
    conditions: z.array(conditionSchema).max(20).default([]),
    actions: z.array(actionSchema).min(1).max(20),
    run_once_per_record: z.boolean().default(true),
    is_active: z.boolean().default(true),
  })
  .refine((r) => r.trigger_type !== "inactive_days" || Boolean(r.trigger_config.days), {
    message: "Trigger 'tidak ada aktivitas' butuh jumlah hari",
  })
  .refine((r) => r.trigger_type !== "due_soon" || Boolean(r.trigger_config.days), {
    message: "Trigger 'mendekati jatuh tempo' butuh jumlah hari",
  })
  .refine((r) => r.trigger_type !== "score_reached" || typeof r.trigger_config.score === "number", {
    message: "Trigger 'skor tercapai' butuh ambang skor",
  })
  .refine(
    (r) => r.actions.every((a) => a.type !== "update_field" || UPDATABLE_FIELDS[r.object].includes(a.field)),
    { message: "Field pada aksi update_field tidak diizinkan untuk objek ini" }
  );
export type WorkflowRuleInput = z.infer<typeof workflowRuleSchema>;

/** Nilai record (snapshot) + perubahan (updated) untuk evaluasi kondisi. */
export type RecordSnapshot = Record<string, unknown>;
export type RecordChanges = Record<string, { from: unknown; to: unknown }>;

function norm(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "boolean") return v ? "true" : "false";
  return String(v).trim().toLowerCase();
}

export function evaluateCondition(
  cond: WorkflowCondition,
  record: RecordSnapshot,
  changes: RecordChanges = {}
): boolean {
  const actual = record[cond.field];
  const a = norm(actual);
  const v = norm(cond.value);
  switch (cond.op) {
    case "eq":
      return a === v;
    case "neq":
      return a !== v;
    case "in":
      return Array.isArray(cond.value) && cond.value.map(norm).includes(a);
    case "not_in":
      return !(Array.isArray(cond.value) && cond.value.map(norm).includes(a));
    case "contains":
      return v.length > 0 && a.includes(v);
    case "gt":
      return Number(actual) > Number(cond.value);
    case "gte":
      return Number(actual) >= Number(cond.value);
    case "lt":
      return Number(actual) < Number(cond.value);
    case "lte":
      return Number(actual) <= Number(cond.value);
    case "is_empty":
      return a.length === 0;
    case "not_empty":
      return a.length > 0;
    case "changed":
      return cond.field in changes;
    case "changed_to":
      return cond.field in changes && norm(changes[cond.field].to) === v;
    default:
      return false;
  }
}

/** Semua kondisi harus terpenuhi (AND). Tanpa kondisi = selalu cocok. */
export function evaluateConditions(
  conditions: WorkflowCondition[],
  record: RecordSnapshot,
  changes: RecordChanges = {}
): boolean {
  return conditions.every((c) => evaluateCondition(c, record, changes));
}

/**
 * Render placeholder {{lead.org_name}}, {{deal.title}}, {{owner.name}},
 * {{stage.name}}, {{score}}, {{task.title}} … dari konteks bersarang.
 * Kunci tak dikenal → string kosong (pesan tetap rapi).
 */
export function renderTemplate(template: string, context: Record<string, unknown>): string {
  return template
    .replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_m, path: string) => {
      const value = path.split(".").reduce<unknown>((acc, key) => {
        if (acc && typeof acc === "object" && key in (acc as Record<string, unknown>)) {
          return (acc as Record<string, unknown>)[key];
        }
        return undefined;
      }, context);
      if (value === null || value === undefined) return "";
      if (typeof value === "number") return formatNumber(value, 3);
      return String(value);
    })
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/** event_type internal → (object, trigger) yang dicari di crm_workflow_rules. */
export function triggerForEvent(eventType: string): { object: WorkflowObject; trigger: WorkflowTrigger } | null {
  const [obj, evt] = eventType.split(".");
  if (!(WORKFLOW_OBJECTS as readonly string[]).includes(obj)) return null;
  const object = obj as WorkflowObject;
  switch (evt) {
    case "created":
      return { object, trigger: "created" };
    case "updated":
      return { object, trigger: "updated" };
    case "stage_changed":
      return { object, trigger: "stage_changed" };
    case "status_changed":
    case "done":
      return { object, trigger: "status_changed" };
    case "score_changed":
      return { object, trigger: "score_reached" };
    default:
      return null;
  }
}

/** Pisahkan aksi sebelum & sesudah `wait` pertama; delay dalam ms. */
export function splitAtWait(actions: WorkflowAction[]): {
  now: WorkflowAction[];
  later: WorkflowAction[];
  delayMs: number;
} {
  const idx = actions.findIndex((a) => a.type === "wait");
  if (idx === -1) return { now: actions, later: [], delayMs: 0 };
  const wait = actions[idx] as Extract<WorkflowAction, { type: "wait" }>;
  const delayMs = ((wait.days ?? 0) * 24 + (wait.hours ?? 0)) * 3_600_000;
  return { now: actions.slice(0, idx), later: actions.slice(idx + 1), delayMs };
}

/** Round-robin deterministik: indeks = jumlah run sebelumnya mod jumlah kandidat. */
export function pickRoundRobin(userIds: string[], previousRuns: number): string | null {
  if (userIds.length === 0) return null;
  return userIds[previousRuns % userIds.length];
}
