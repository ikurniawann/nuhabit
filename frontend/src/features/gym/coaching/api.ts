/** Klien API Gym → Personal Training dan Asesmen Kebugaran (modul Go gym-coaching). */
import type { Assessment, MetricKey } from "@/lib/gym/assessments";
import { call, remove, send } from "../shared";

export type PtStatus = "requested" | "confirmed" | "completed" | "cancelled";
export type ParticipantStatus = PtStatus | "no_show";

export interface PtType {
  id: string;
  name: string;
  description: string;
  duration_min: number;
  credit_cost: number;
  capacity: number;
}

export interface PtCoach {
  id: string;
  name: string;
  specialization: string;
  bio: string;
  photo_url: string | null;
  branch_id: string | null;
  /** Zona cabang coach: jadwal PT dan slot dibaca di zona ini. */
  timezone?: string;
}

export interface PtParticipant {
  id: string;
  appointment_id: string;
  customer_id: string;
  name: string | null;
  phone: string | null;
  status: ParticipantStatus;
  late_cancel: boolean;
  credits_charged: number;
}

export interface PtAppointment {
  id: string;
  coach_id: string;
  coach_name: string;
  class_type_id: string;
  class_type_name: string;
  branch_id: string | null;
  branch_name: string | null;
  /** Zona cabang sesi PT. */
  timezone?: string;
  starts_at: string;
  ends_at: string;
  capacity: number;
  credit_cost: number;
  status: PtStatus;
  source: "member" | "staff";
  notes: string;
  cancel_reason: string | null;
  created_at: string;
  participants: PtParticipant[];
}

export interface Window {
  id?: string;
  weekday: number;
  start_time: string;
  end_time: string;
}

export interface AvailabilityException {
  id: string;
  date: string;
  kind: "off" | "extra";
  start_time: string | null;
  end_time: string | null;
  note: string;
}

export interface Availability {
  coach_id: string;
  /** Zona cabang coach; jam mingguan dan pengecualian dibaca di zona ini. */
  timezone?: string;
  weekly: Window[];
  exceptions: AvailabilityException[];
}

export interface Slot {
  starts_at: string;
  ends_at: string;
}

export interface PtMemberHit {
  id: string;
  name: string | null;
  phone: string | null;
  is_active: boolean | null;
  pt_credits: number;
}

export interface ClassTypeFlag {
  id: string;
  name: string;
  is_personal: boolean;
}

export interface BookInput {
  coach_id: string;
  class_type_id: string;
  starts_at: string;
  capacity: number;
  customer_ids: string[];
  notes: string;
}

export interface ExceptionInput {
  date: string;
  kind: "off" | "extra";
  start_time: string | null;
  end_time: string | null;
  note: string;
}

export interface CancelResult {
  late: boolean;
  penalty: number;
}

/** Isi form asesmen; metrik kosong = null. */
export type AssessmentInput = { customer_id: string; coach_id: string | null; assessed_on: string; notes: string; goals: string } & Record<
  MetricKey,
  number | null
>;

const pt = "/api/gym/pt";
const qs = (params: Record<string, string | number | undefined>) =>
  new URLSearchParams(
    Object.entries(params).flatMap(([k, v]) => (v === undefined || v === "" ? [] : [[k, String(v)]]))
  ).toString();

export const coachingApi = {
  types: () => call<PtType[]>(`${pt}/class-types`),
  coaches: (all = false) => call<PtCoach[]>(`${pt}/coaches${all ? "?all=1" : ""}`),
  members: (q: string, classTypeId?: string) =>
    call<PtMemberHit[]>(`${pt}/members?${qs({ q, class_type_id: classTypeId })}`),
  appointments: (params: { from: string; to: string; coach_id?: string; status?: string; customer_id?: string }) =>
    call<PtAppointment[]>(`${pt}/appointments?${qs(params)}`),
  book: (input: BookInput) => send<{ id: string }>(`${pt}/appointments`, input),
  act: (id: string, body: { action: "confirm" | "cancel" | "complete" | "add_member"; reason?: string; customer_id?: string }) =>
    send<PtAppointment>(`${pt}/appointments/${id}`, body),
  participant: (id: string, body: { action: "cancel" | "no_show"; waive: boolean }) =>
    send<CancelResult>(`${pt}/participants/${id}`, body),
  slots: (params: { coach_id: string; class_type_id: string; from: string; days: number }) =>
    call<Slot[]>(`${pt}/slots?${qs(params)}`),
  availability: (coachId: string) => call<Availability>(`${pt}/availability/${coachId}`),
  setWeekly: (coachId: string, weekly: Window[]) => send<Availability>(`${pt}/availability/${coachId}`, { weekly }, "PUT"),
  addException: (coachId: string, input: ExceptionInput) =>
    send<{ id: string }>(`${pt}/availability/${coachId}/exceptions`, input),
  deleteException: (id: string) => remove<{ id: string }>(`${pt}/availability/exceptions/${id}`),
  typeFlags: () => call<ClassTypeFlag[]>(`${pt}/class-type-flags`),
  setPersonal: (id: string, isPersonal: boolean) =>
    send<{ is_personal: boolean }>(`${pt}/class-type-flags/${id}`, { is_personal: isPersonal }, "PATCH"),

  assessments: (params: { customer_id?: string; q?: string }) => call<Assessment[]>(`/api/gym/assessments?${qs(params)}`),
  createAssessment: (input: AssessmentInput) => send<{ id: string }>("/api/gym/assessments", input),
  updateAssessment: (id: string, input: AssessmentInput) => send<Assessment>(`/api/gym/assessments/${id}`, input, "PUT"),
  deleteAssessment: (id: string) => remove<{ id: string }>(`/api/gym/assessments/${id}`),
};

export const COACHING_KEYS = {
  all: ["gym", "coaching"] as const,
  types: ["gym", "coaching", "types"] as const,
  coaches: (all: boolean) => ["gym", "coaching", "coaches", all] as const,
  appointments: ["gym", "coaching", "appointments"] as const,
  availability: (coachId: string) => ["gym", "coaching", "availability", coachId] as const,
  slots: ["gym", "coaching", "slots"] as const,
  members: ["gym", "coaching", "members"] as const,
  flags: ["gym", "coaching", "flags"] as const,
  assessments: ["gym", "coaching", "assessments"] as const,
};

export const PT_BADGE: Record<
  ParticipantStatus,
  { label: string; variant: "outline" | "ink" | "secondary" | "muted" | "destructive" | "info" }
> = {
  requested: { label: "Menunggu konfirmasi", variant: "info" },
  confirmed: { label: "Terkonfirmasi", variant: "ink" },
  completed: { label: "Selesai", variant: "secondary" },
  cancelled: { label: "Batal", variant: "muted" },
  no_show: { label: "Tidak hadir", variant: "destructive" },
};
