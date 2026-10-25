/**
 * Klien API Gym → Member Perhatian Khusus (penanda, PAR-Q, catatan coach)
 * dan SOP Coach. Detail medis hanya dikirim server ke manajer gym dan coach
 * yang memegang sesi member itu hari ini atau nanti; staf lain menerima
 * jumlahnya saja (hidden_medical).
 */
import { call, remove, send, upload } from "../shared";

export type FlagCategory = "general" | "medical";
export type FlagColor = "lime" | "info" | "warning" | "danger" | "success" | "ink";
export type FlagIcon = "flag" | "bandage" | "heart" | "baby" | "clipboard" | "sprout" | "star" | "message" | "alert" | "shield";
export type ReviewStatus = "pending" | "cleared" | "restricted" | "doctor_note";
export type ReviewDecision = Exclude<ReviewStatus, "pending">;

export interface FlagType {
  id: string;
  code: string;
  label: string;
  category: FlagCategory;
  color: FlagColor;
  icon: FlagIcon;
  default_expiry_days: number | null;
  sort_order: number;
  is_system: boolean;
  is_active: boolean;
}

export interface MemberFlag {
  id: string;
  customer_id: string;
  customer_name: string | null;
  type_id: string;
  type_code: string;
  type_label: string;
  category: FlagCategory;
  color: FlagColor;
  icon: FlagIcon;
  note: string;
  /** Hari terakhir penanda tampil (YYYY-MM-DD, WIB); null = sampai dihapus. */
  expires_on: string | null;
  source: "staff" | "coach" | "parq";
  review_status: ReviewStatus | null;
  review_note: string;
  reviewed_at: string | null;
  reviewed_by_name: string;
  created_by_name: string;
  created_at: string;
}

/** Penanda satu member untuk roster: yang boleh dibaca dan jumlah medis yang disembunyikan. */
export interface MemberFlags {
  customer_id: string;
  flags: MemberFlag[];
  hidden_medical: number;
}

export interface FlagPage {
  rows: MemberFlag[];
  total: number;
  page: number;
  page_size: number;
  hidden_medical: number;
}

export interface FlagTypeInput {
  label?: string;
  category?: FlagCategory;
  color?: FlagColor;
  icon?: FlagIcon;
  default_expiry_days?: number | null;
  sort_order?: number;
  is_active?: boolean;
}

export interface NewFlag {
  customer_id: string;
  type_id: string;
  note?: string;
  /** Tanpa kunci ini masa berlaku bawaan jenisnya dipakai; null = tanpa batas. */
  expires_on?: string | null;
}

export interface ParqQuestion {
  code: string;
  short: string;
}

export interface ParqDeclaration {
  id: string;
  version: string;
  answers: Record<string, boolean>;
  has_yes: boolean;
  details: string;
  submitted_at: string;
  expires_at: string;
}

export interface ParqStatus {
  version: string;
  questions: ParqQuestion[];
  due: boolean;
  last: ParqDeclaration | null;
}

export interface SessionNote {
  id: string;
  customer_id: string;
  coach_id: string;
  coach_name: string;
  body: string;
  carry_forward: boolean;
  /** Masih dibawa ke sesi berikutnya (belum dilepas). */
  pinned: boolean;
  session_id: string | null;
  pt_appointment_id: string | null;
  session_label: string | null;
  session_starts_at: string | null;
  released_at: string | null;
  released_by_name: string;
  created_at: string;
  mine: boolean;
}

export interface MemberNotes {
  customer_id: string;
  notes: SessionNote[];
}

export interface NewNote {
  customer_id: string;
  session_id?: string;
  pt_appointment_id?: string;
  body: string;
  carry_forward: boolean;
}

const qs = (params: Record<string, string>) => new URLSearchParams(params).toString();
const flags = "/api/gym/member-flags";

/** Id unik terurut, supaya kunci query roster stabil. */
export const memberIds = (ids: readonly string[]) => [...new Set(ids)].sort();

export const careApi = {
  types: (all = false) => call<FlagType[]>(`/api/gym/member-flag-types${all ? "?all=1" : ""}`),
  createType: (body: FlagTypeInput) => send<FlagType>("/api/gym/member-flag-types", body),
  updateType: (id: string, body: FlagTypeInput) => send<{ id: string }>(`/api/gym/member-flag-types/${id}`, body, "PATCH"),
  list: (params: Record<string, string>) => call<FlagPage>(`${flags}?${qs(params)}`),
  forMembers: (ids: readonly string[]) => call<MemberFlags[]>(`${flags}/members?${qs({ ids: ids.join(",") })}`),
  addFlag: (body: NewFlag) => send<MemberFlag>(flags, body),
  removeFlag: (id: string) => remove<{ id: string }>(`${flags}/${id}`),
  review: (id: string, body: { decision: ReviewDecision; note: string }) => send<{ id: string }>(`${flags}/${id}/review`, body),
  parq: (customerId: string) => call<ParqStatus>(`/api/gym/health-declarations/${customerId}`),
  notes: (ids: readonly string[]) => call<MemberNotes[]>(`/api/gym/coach-notes?${qs({ customer_ids: ids.join(",") })}`),
  noteHistory: (customerId: string) => call<SessionNote[]>(`/api/gym/coach-notes/members/${customerId}`),
  addNote: (body: NewNote) => send<SessionNote>("/api/gym/coach-notes", body),
  releaseNote: (id: string) => send<{ id: string }>(`/api/gym/coach-notes/${id}/release`, {}),
  deleteNote: (id: string) => remove<{ id: string }>(`/api/gym/coach-notes/${id}`),
};

export const CARE_KEYS = {
  all: ["gym", "care"] as const,
  types: (all: boolean) => ["gym", "care", "types", all] as const,
  list: (params: Record<string, string>) => ["gym", "care", "list", params] as const,
  members: (ids: readonly string[]) => ["gym", "care", "members", ...ids] as const,
  parq: (customerId: string) => ["gym", "care", "parq", customerId] as const,
  notes: (ids: readonly string[]) => ["gym", "care", "notes", ...ids] as const,
  noteHistory: (customerId: string) => ["gym", "care", "note-history", customerId] as const,
};

/* ── SOP ─────────────────────────────────────────────────────────────────── */

export interface SopDocument {
  id: string;
  title: string;
  is_active: boolean;
  /** Kode role IAM; kosong = semua coach aktif. */
  audience_roles: string[];
  remind_after_days: number;
  version_id: string;
  version: number;
  published_at: string;
  change_note: string;
  readers_total: number;
  readers_acked: number;
}

export interface SopVersion {
  id: string;
  version: number;
  title: string;
  body: string;
  attachment_name: string | null;
  change_note: string;
  published_by_name: string;
  published_at: string;
  acked: number;
}

export interface SopReader {
  user_id: string;
  name: string;
  coach: boolean;
  acknowledged_at: string | null;
  last_reminded_at: string | null;
}

export interface SopDetail extends SopDocument {
  body: string;
  attachment_name: string | null;
  versions: SopVersion[];
  readers: SopReader[];
}

export interface MySop {
  document_id: string;
  version_id: string;
  version: number;
  title: string;
  body: string;
  attachment_name: string | null;
  change_note: string;
  published_at: string;
  acknowledged_at: string | null;
}

export interface SopRole {
  code: string;
  name: string;
}

export interface RemindResult {
  pending: number;
  sent: number;
  skipped: number;
}

const sop = "/api/gym/sop";

export const sopApi = {
  list: () => call<SopDocument[]>(sop),
  get: (id: string) => call<SopDetail>(`${sop}/${id}`),
  roles: () => call<SopRole[]>(`${sop}/roles`),
  /** title, body, change_note, audience_roles (koma), remind_after_days, file (PDF). */
  create: (form: FormData) => upload<{ id: string }>(sop, form),
  /** title, body, change_note, file (PDF), keep_attachment ("1"). */
  publish: (id: string, form: FormData) => upload<{ version: number }>(`${sop}/${id}/versions`, form),
  update: (id: string, body: { audience_roles?: string[]; remind_after_days?: number; is_active?: boolean }) =>
    send<{ id: string }>(`${sop}/${id}`, body, "PATCH"),
  remind: (id: string) => send<RemindResult>(`${sop}/${id}/remind`, {}),
  mine: () => call<MySop[]>("/api/gym/my-classes/sop"),
  ack: (versionId: string) => send<{ version_id: string }>(`/api/gym/my-classes/sop/${versionId}/ack`, {}),
  fileUrl: (versionId: string) => `${sop}/versions/${versionId}/file`,
};

export const SOP_KEYS = {
  all: ["gym", "sop"] as const,
  list: ["gym", "sop", "list"] as const,
  detail: (id: string) => ["gym", "sop", "detail", id] as const,
  roles: ["gym", "sop", "roles"] as const,
  mine: ["gym", "sop", "mine"] as const,
};
