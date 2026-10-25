/** Klien API Gym → Otomasi & Pengingat (Go /api/gym/automation). */
import { call, send } from "../shared";

export type JobStatus = "never" | "running" | "ok" | "failed";

export interface JobSetting {
  key: string;
  label: string;
  unit: string;
  min: number;
  max: number;
  default: number;
  value: number;
}

export interface JobRule {
  key: string;
  label: string;
  value: number;
  unit: string;
}

export interface JobView {
  name: string;
  module: string;
  label: string;
  description: string;
  everySeconds: number;
  enabled: boolean;
  settings: JobSetting[];
  rules: JobRule[];
  status: JobStatus;
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
  lastSucceededAt: string | null;
  lastError: string | null;
}

export interface MemberHit {
  id: string;
  name: string | null;
  phone: string | null;
}

export interface MemberLog {
  member: MemberHit;
  reminders: { kind: string; subjectId: string; period: string; sentAt: string }[];
  notifications: { id: string; type: string; title: string; body: string; createdAt: string; readAt: string | null }[];
}

const BASE = "/api/gym/automation";

export const automationApi = {
  jobs: () => call<JobView[]>(`${BASE}/jobs`),
  save: (name: string, patch: { enabled?: boolean; settings?: Record<string, number> }) =>
    send<{ name: string }>(`${BASE}/jobs/${name}`, patch, "PATCH"),
  run: (name: string) => send<{ name: string }>(`${BASE}/jobs/${name}/run`, {}),
  members: (q: string) => call<MemberHit[]>(`${BASE}/members?q=${encodeURIComponent(q)}`),
  memberLog: (id: string) => call<MemberLog>(`${BASE}/members/${id}/notifications`),
};

export const AUTOMATION_KEYS = {
  jobs: ["gym", "automation", "jobs"] as const,
  members: (q: string) => ["gym", "automation", "members", q] as const,
  log: (id: string) => ["gym", "automation", "log", id] as const,
};

export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  never: "Belum pernah jalan",
  running: "Sedang berjalan",
  ok: "Berhasil",
  failed: "Gagal",
};

/** Jenis pengingat di log kirim (platform.reminder_sends). */
export const REMINDER_LABELS: Record<string, string> = {
  gym_class_reminder: "Pengingat kelas",
  gym_pt_reminder: "Pengingat PT",
  gym_credit_expiry: "Kredit akan kedaluwarsa",
  gym_pass_expiry: "Pass hampir berakhir",
  gym_low_balance: "Kredit menipis",
};

export const reminderLabel = (kind: string) => REMINDER_LABELS[kind] ?? kind;

/** Interval job: "tiap menit", "tiap 5 menit", "tiap jam", "tiap 6 jam", "tiap hari". */
export function formatEvery(seconds: number): string {
  if (seconds % 86400 === 0) return seconds === 86400 ? "tiap hari" : `tiap ${seconds / 86400} hari`;
  if (seconds % 3600 === 0) return seconds === 3600 ? "tiap jam" : `tiap ${seconds / 3600} jam`;
  if (seconds % 60 === 0) return seconds === 60 ? "tiap menit" : `tiap ${seconds / 60} menit`;
  return `tiap ${seconds} detik`;
}
