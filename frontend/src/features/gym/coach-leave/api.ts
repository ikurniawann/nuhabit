/** Klien API Gym → Cuti & Pengganti Coach (Program Director) dan tab Cuti di Kelas Saya. */
import { call, GymApiError, remove, send } from "../shared";

export type CoverStatus = "open" | "requested" | "accepted" | "declined" | "assigned" | "cancelled" | "void";

export const COVER_BADGE: Record<CoverStatus, { label: string; variant: "warning" | "info" | "success" | "destructive" | "muted" | "ink" }> = {
  open: { label: "Butuh pengganti", variant: "warning" },
  requested: { label: "Menunggu jawaban", variant: "info" },
  accepted: { label: "Pengganti menerima", variant: "success" },
  declined: { label: "Ditolak pengganti", variant: "destructive" },
  assigned: { label: "Ditunjuk Program Director", variant: "success" },
  cancelled: { label: "Sesi dibatalkan", variant: "ink" },
  void: { label: "Tidak berlaku", variant: "muted" },
};

export const LEAVE_TYPE_LABEL: Record<string, string> = {
  annual: "Cuti tahunan",
  unpaid: "Cuti di luar tanggungan",
  marriage: "Cuti menikah",
  maternity: "Cuti melahirkan",
  pilgrimage: "Cuti ibadah",
  sick: "Sakit",
  emergency: "Izin darurat",
  menstrual: "Cuti haid",
  paternity: "Cuti ayah",
  bereavement: "Cuti duka",
};
export const LEAVE_TYPES = Object.keys(LEAVE_TYPE_LABEL);

export const LEAVE_STATUS_BADGE: Record<string, { label: string; variant: "warning" | "success" | "destructive" | "muted" }> = {
  pending: { label: "Menunggu", variant: "warning" },
  approved: { label: "Disetujui", variant: "success" },
  rejected: { label: "Ditolak", variant: "destructive" },
  cancelled: { label: "Dibatalkan", variant: "muted" },
};

export const INCIDENT_LABEL: Record<string, string> = {
  no_show: "Tidak hadir tanpa kabar",
  short_notice_leave: "Cuti mendadak",
  late: "Terlambat",
};

export const CHANGE_LABEL: Record<string, string> = {
  coach_changed: "Coach diganti",
  moved: "Jadwal dipindah",
  cancelled: "Dibatalkan",
};

export interface Coach {
  id: string;
  name: string;
  branch_id: string | null;
}

export interface Blackout {
  id: string;
  branch_id: string | null;
  date_from: string;
  date_to: string;
  reason: string;
  branch_name?: string | null;
}

export interface Cover {
  id: string;
  leave_id: string;
  status: CoverStatus;
  kind: "class" | "pt";
  session_id: string | null;
  pt_appointment_id: string | null;
  coach_id: string;
  coach_name: string;
  substitute_coach_id: string | null;
  substitute_name: string | null;
  requested_at: string | null;
  respond_by: string | null;
  responded_at: string | null;
  cancel_reason: string | null;
  note: string | null;
  applied_at: string | null;
  starts_at: string;
  ends_at: string;
  class_name: string;
  session_status: string;
  booked: number;
  timezone: string;
}

export interface Leave {
  id: string;
  status: string;
  leave_type: string;
  start_date: string;
  end_date: string;
  total_days: number;
  reason: string;
  is_short_notice: boolean;
  notice_days: number | null;
  blackout_exception_requested: boolean;
  blackout_override_reason: string | null;
  rejection_reason: string | null;
  created_at: string;
  employee_id: string;
  employee_name: string;
  coach: Coach;
  covers: Cover[];
}

export interface Approver {
  user_id: string;
  name: string;
  on_leave: boolean;
}

export interface QueueLeave extends Leave {
  blockers: number;
  blackouts: Blackout[];
  approvers: { approvers: Approver[] | null; source: "program_director" | "backup" | "super_admin" };
  can_decide: boolean;
  cannot_decide_reason?: string;
}

export interface Candidate {
  coach_id: string;
  name: string;
  clash: boolean;
  on_leave: boolean;
  qualified: boolean;
  week_load: number;
}

export interface NoticeRule {
  min_days: number;
  allow_short_notice: boolean;
  blackout: boolean;
}

export interface Portal {
  coach: Coach | null;
  leaves: Leave[];
  incoming: Cover[];
  blackouts: Blackout[];
  notice_rules: Record<string, NoticeRule>;
  has_employee: boolean;
  substitute_response_hours: number;
}

export interface Affected {
  kind: "class" | "pt";
  id: string;
  starts_at: string;
  ends_at: string;
  class_name: string;
  booked: number;
  timezone: string;
}

export interface Impact {
  sessions: Affected[];
  classes: number;
  pt: number;
  members: number;
  notice: { ok: boolean; short_notice: boolean; notice_days: number; min_days: number; earliest_start?: string; message?: string } | null;
  blackouts: Blackout[];
}

export interface Settings {
  backup_approver_user_id: string | null;
  notice_rules: Record<string, NoticeRule>;
  substitute_response_hours: number;
  warning_threshold: number;
  warning_window_days: number;
  deduction_percent: Record<string, number>;
}

export interface StaffUser {
  id: string;
  full_name: string;
  role: string;
}

export interface Incident {
  id: string;
  coach_id: string;
  coach_name: string;
  kind: string;
  occurred_on: string;
  session_id: string | null;
  leave_id: string | null;
  minutes_late: number | null;
  note: string;
  deduction_percent: number;
  status: "active" | "void";
  void_reason: string | null;
  created_at: string;
}

export interface Warning {
  id: string;
  coach_id: string;
  coach_name: string;
  level: number;
  status: "proposed" | "issued" | "dismissed";
  window_from: string;
  window_to: string;
  incident_ids: string[];
  decided_at: string | null;
  decision_note: string | null;
  created_at: string;
}

export interface Change {
  session_id: string;
  class_name: string;
  starts_at: string;
  status: string;
  coach_name: string | null;
  original_coach_name: string | null;
  change_kind: string;
  changed_at: string;
  change_notice_late: boolean;
  hours_before_start: number;
  booked: number;
  branch_name: string | null;
  timezone: string;
}

export interface ChangeReport {
  changes: Change[];
  total: number;
  late: number;
  by_kind: Record<string, number>;
}

export interface LeaveRequest {
  leave_type: string;
  start_date: string;
  end_date: string;
  reason: string;
  blackout_exception_requested: boolean;
}

/** Rute HRIS membalas tanpa amplop {success, data}; galat tetap {success:false, error}. */
async function hris<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new GymApiError(json.error || json.message || "Permintaan gagal", json.code);
  return json as T;
}

const qs = (params: Record<string, string>) => new URLSearchParams(Object.entries(params).filter(([, v]) => v !== "")).toString();

export const coachLeaveApi = {
  queue: (branchId = "") => call<QueueLeave[]>(`/api/gym/coach-leave/queue?${qs({ branch_id: branchId })}`),
  candidates: (coverId: string) => call<Candidate[]>(`/api/gym/coach-leave/covers/${coverId}/candidates`),
  assign: (coverId: string, coachId: string) => send<Cover>(`/api/gym/coach-leave/covers/${coverId}/assign`, { coach_id: coachId }),
  cancelSession: (coverId: string, reason: string) => send<Cover>(`/api/gym/coach-leave/covers/${coverId}/cancel-session`, { reason }),
  decide: (leaveId: string, action: "approve" | "reject", extra: { rejection_reason?: string; blackout_override_reason?: string }) =>
    hris<{ message: string }>("/api/hris/leaves/approve", { leave_id: leaveId, action, ...extra }),
  settings: () =>
    call<{ settings: Settings; users: StaffUser[] }>("/api/gym/coach-leave/settings"),
  saveSettings: (s: Settings) => send<Settings>("/api/gym/coach-leave/settings", s, "PUT"),
  blackouts: () => call<Blackout[]>("/api/gym/coach-leave/blackouts"),
  addBlackout: (b: { branch_id: string | null; date_from: string; date_to: string; reason: string }) =>
    send<{ id: string }>("/api/gym/coach-leave/blackouts", b),
  deleteBlackout: (id: string) => remove<{ id: string }>(`/api/gym/coach-leave/blackouts/${id}`),
  incidents: (params: { coach_id?: string; from?: string; to?: string } = {}) =>
    call<Incident[]>(`/api/gym/coach-leave/incidents?${qs({ coach_id: params.coach_id ?? "", from: params.from ?? "", to: params.to ?? "" })}`),
  recordIncident: (body: { coach_id: string; kind: string; occurred_on: string; minutes_late?: number; note: string }) =>
    send<Incident>("/api/gym/coach-leave/incidents", body),
  voidIncident: (id: string, reason: string) => send<Incident>(`/api/gym/coach-leave/incidents/${id}/void`, { reason }),
  warnings: () => call<Warning[]>("/api/gym/coach-leave/warnings"),
  decideWarning: (id: string, action: "issue" | "dismiss", note: string) =>
    send<{ id: string }>(`/api/gym/coach-leave/warnings/${id}`, { action, note }),
  changes: (from: string, to: string, branchId = "") =>
    call<ChangeReport>(`/api/gym/coach-leave/changes?${qs({ from, to, branch_id: branchId })}`),

  portal: () => call<Portal>("/api/gym/my-classes/leave"),
  impact: (from: string, to: string, leaveType: string) =>
    call<Impact>(`/api/gym/my-classes/leave/impact?${qs({ from, to, leave_type: leaveType })}`),
  myCandidates: (coverId: string) => call<Candidate[]>(`/api/gym/my-classes/leave/covers/${coverId}/candidates`),
  requestSubstitute: (coverId: string, coachId: string) =>
    send<Cover>(`/api/gym/my-classes/leave/covers/${coverId}/request`, { coach_id: coachId }),
  respond: (coverId: string, accept: boolean) => send<Cover>(`/api/gym/my-classes/leave/covers/${coverId}/respond`, { accept }),
  submitLeave: (body: LeaveRequest) => hris<{ message: string }>("/api/hris/leaves", body),
};

export const COACH_LEAVE_KEYS = {
  all: ["gym", "coach-leave"] as const,
  queue: (branchId: string) => ["gym", "coach-leave", "queue", branchId] as const,
  candidates: (coverId: string) => ["gym", "coach-leave", "candidates", coverId] as const,
  settings: ["gym", "coach-leave", "settings"] as const,
  blackouts: ["gym", "coach-leave", "blackouts"] as const,
  incidents: ["gym", "coach-leave", "incidents"] as const,
  warnings: ["gym", "coach-leave", "warnings"] as const,
  changes: (from: string, to: string, branchId: string) => ["gym", "coach-leave", "changes", from, to, branchId] as const,
  portal: ["gym", "my-classes", "leave"] as const,
  impact: (from: string, to: string, type: string) => ["gym", "my-classes", "leave", "impact", from, to, type] as const,
};

/** "2026-11-12" atau "2026-11-12 s.d. 2026-11-13". */
export const leaveRange = (l: Pick<Leave, "start_date" | "end_date">) =>
  l.start_date === l.end_date ? l.start_date : `${l.start_date} s.d. ${l.end_date}`;
