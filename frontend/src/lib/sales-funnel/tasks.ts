/**
 * EPIC-050 Fase 1 (T-1.5) — logika murni Tasks & Kalender.
 *
 * Task = baris crm.crm_sales_activities yang digeneralisasi: subjek polimorfik
 * (lead/deal/account/contact/member), prioritas, status, rekurensi, pengingat.
 * Semua fungsi di sini bebas I/O supaya mudah diuji (vitest).
 */
import { z } from "zod";

export const TASK_SUBJECT_TYPES = ["lead", "deal", "account", "contact", "member"] as const;
export type TaskSubjectType = (typeof TASK_SUBJECT_TYPES)[number];

export const TASK_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const TASK_STATUSES = ["open", "in_progress", "done", "cancelled"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

/** Kanal pengingat. `email` sudah disiapkan tapi DITUNDA (keputusan owner 2026-09-13). */
export const REMINDER_CHANNELS = ["wa", "in_app", "email"] as const;
export type ReminderChannel = (typeof REMINDER_CHANNELS)[number];
export const DEFAULT_REMINDER_CHANNELS: ReminderChannel[] = ["wa", "in_app"];

export const RECURRENCE_FREQS = ["daily", "weekly", "monthly"] as const;
export type RecurrenceFreq = (typeof RECURRENCE_FREQS)[number];

export const recurrenceSchema = z
  .object({
    freq: z.enum(RECURRENCE_FREQS),
    /** setiap N hari/minggu/bulan (1..52) */
    interval: z.number().int().min(1).max(52).default(1),
    /** YYYY-MM-DD inklusif; null = tanpa batas */
    until: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .default(null),
  })
  .strict();
export type Recurrence = z.infer<typeof recurrenceSchema>;

const ISO_DATETIME = z.string().datetime({ offset: true });

/** Payload buat task baru (POST /api/sales-funnel/activities). */
export const createTaskSchema = z
  .object({
    subject_type: z.enum(TASK_SUBJECT_TYPES).optional(),
    subject_id: z.string().uuid().optional().nullable(),
    // kompatibilitas ke belakang dengan klien lama
    deal_id: z.string().uuid().optional().nullable(),
    lead_id: z.string().uuid().optional().nullable(),
    activity_type: z
      .enum(["telepon", "wa", "meeting", "catatan", "tugas", "email"])
      .default("tugas"),
    title: z.string().trim().max(200).optional().nullable(),
    notes: z.string().trim().max(2000).optional().nullable(),
    due_at: ISO_DATETIME.optional().nullable(),
    reminder_at: ISO_DATETIME.optional().nullable(),
    reminder_channels: z.array(z.enum(REMINDER_CHANNELS)).max(3).optional(),
    priority: z.enum(TASK_PRIORITIES).default("normal"),
    status: z.enum(TASK_STATUSES).default("open"),
    recurrence: recurrenceSchema.optional().nullable(),
    owner_user_id: z.string().uuid().optional().nullable(),
    is_done: z.boolean().default(false),
  })
  .refine((v) => v.deal_id || v.lead_id || (v.subject_type && v.subject_id), {
    message: "Task harus terkait lead, deal, account, contact, atau member",
  })
  .refine((v) => !v.recurrence || v.due_at, {
    message: "Task berulang wajib punya jatuh tempo",
  });
export type CreateTaskInput = z.infer<typeof createTaskSchema>;

/** Payload ubah task (PATCH /api/sales-funnel/activities/[id]). */
export const updateTaskSchema = z
  .object({
    activity_type: z
      .enum(["telepon", "wa", "meeting", "catatan", "tugas", "email"])
      .optional(),
    title: z.string().trim().max(200).optional().nullable(),
    notes: z.string().trim().max(2000).optional().nullable(),
    due_at: ISO_DATETIME.optional().nullable(),
    reminder_at: ISO_DATETIME.optional().nullable(),
    reminder_channels: z.array(z.enum(REMINDER_CHANNELS)).max(3).optional(),
    priority: z.enum(TASK_PRIORITIES).optional(),
    status: z.enum(TASK_STATUSES).optional(),
    recurrence: recurrenceSchema.optional().nullable(),
    owner_user_id: z.string().uuid().optional().nullable(),
    /** klien lama: true → status done, false → open */
    is_done: z.boolean().optional(),
  })
  .strict();
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;

/**
 * Normalisasi subjek: klien lama mengirim deal_id/lead_id, klien baru
 * subject_type/subject_id. Deal diprioritaskan (aktivitas deal mewarisi venue deal).
 */
export function resolveTaskSubject(input: {
  subject_type?: TaskSubjectType;
  subject_id?: string | null;
  deal_id?: string | null;
  lead_id?: string | null;
}): { subject_type: TaskSubjectType; subject_id: string } | null {
  if (input.deal_id) return { subject_type: "deal", subject_id: input.deal_id };
  if (input.lead_id) return { subject_type: "lead", subject_id: input.lead_id };
  if (input.subject_type && input.subject_id) {
    return { subject_type: input.subject_type, subject_id: input.subject_id };
  }
  return null;
}

/** Status efektif dari kombinasi status + is_done (klien lama). */
export function resolveTaskStatus(input: {
  status?: TaskStatus;
  is_done?: boolean;
}): TaskStatus | undefined {
  if (input.status) return input.status;
  if (input.is_done === true) return "done";
  if (input.is_done === false) return "open";
  return undefined;
}

function addMonthsClamped(date: Date, months: number): Date {
  const d = new Date(date.getTime());
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d;
}

/**
 * Jatuh tempo berikutnya setelah `from` mengikuti aturan rekurensi. Mengembalikan
 * null bila melewati `until`. Bulanan di-clamp ke akhir bulan (31 Jan → 28/29 Feb).
 */
export function nextOccurrence(from: Date, recurrence: Recurrence): Date | null {
  const interval = recurrence.interval ?? 1;
  let next: Date;
  switch (recurrence.freq) {
    case "daily":
      next = new Date(from.getTime() + interval * 86_400_000);
      break;
    case "weekly":
      next = new Date(from.getTime() + interval * 7 * 86_400_000);
      break;
    case "monthly":
      next = addMonthsClamped(from, interval);
      break;
  }
  if (recurrence.until) {
    const [y, m, d] = recurrence.until.split("-").map(Number);
    // inklusif sampai akhir hari `until` (UTC) — cukup untuk penjadwalan harian
    const untilEnd = Date.UTC(y, m - 1, d, 23, 59, 59, 999);
    if (next.getTime() > untilEnd) return null;
  }
  return next;
}

/**
 * Saat task berulang diselesaikan: hasilkan payload task berikutnya
 * (due & reminder digeser dengan selisih yang sama). null = seri selesai.
 */
export function spawnNextTask(task: {
  due_at: string | Date;
  reminder_at?: string | Date | null;
  recurrence: Recurrence;
}): { due_at: Date; reminder_at: Date | null } | null {
  const due = new Date(task.due_at);
  const nextDue = nextOccurrence(due, task.recurrence);
  if (!nextDue) return null;
  let reminder: Date | null = null;
  if (task.reminder_at) {
    const offset = due.getTime() - new Date(task.reminder_at).getTime();
    reminder = new Date(nextDue.getTime() - offset);
  }
  return { due_at: nextDue, reminder_at: reminder };
}

export function isTaskOpen(status: TaskStatus): boolean {
  return status === "open" || status === "in_progress";
}

/** Urutan tampil: urgent dulu, lalu jatuh tempo terdekat. */
export const PRIORITY_RANK: Record<TaskPriority, number> = {
  urgent: 0,
  high: 1,
  normal: 2,
  low: 3,
};
