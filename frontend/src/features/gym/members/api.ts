/** Klien API Gym → Member: daftar member, profil 360, catatan staf, daftar di front desk. */
import type { BookingStatus, GateDenialReason, GateEntryKind } from "@/lib/gym/booking";
import type { AccessSource } from "@/features/gym/scheduling/api";
import type { MemberCredits } from "../credits/api";
import { call, remove, send } from "../shared";

export interface MemberRow {
  id: string;
  name: string | null;
  phone: string;
  email: string | null;
  member_code: string | null;
  is_active: boolean;
  pass_until: string | null;
  pass_name: string | null;
  balance: number;
  last_visit: string | null;
  bookings_next_7_days: number;
}

export interface MemberPage {
  rows: MemberRow[];
  total: number;
  page: number;
  page_size: number;
}

export interface EmergencyContact {
  name: string;
  phone: string;
  relation: string;
}

export interface MemberProfile {
  id: string;
  name: string | null;
  phone: string;
  email: string | null;
  birth_date: string | null;
  gender: "male" | "female" | null;
  photo_url: string | null;
  emergency_contact: EmergencyContact | null;
  is_active: boolean;
  joined_at: string | null;
  membership_tier: string | null;
  member_code: string | null;
  crm_member_id: string;
  waiver: { version: string | null; accepted_at: string | null; current_version: string; current: boolean };
}

export interface MemberBooking {
  id: string;
  session_id: string;
  status: BookingStatus;
  waitlist_position: number | null;
  late_cancel: boolean;
  source: "member" | "admin";
  checked_in_at: string | null;
  starts_at: string;
  credit_cost: number;
  class_type_name: string;
  coach_name: string | null;
  branch_name: string | null;
}

export interface MemberVisit {
  id: string;
  decision: "allowed" | "denied";
  reason: GateDenialReason | null;
  entry_kind: GateEntryKind | null;
  credit_delta: number;
  source: AccessSource;
  created_at: string;
  class_type_name: string | null;
  starts_at: string | null;
}

export interface MemberNote {
  id: string;
  author_id: string;
  author_name: string;
  body: string;
  created_at: string;
  mine: boolean;
}

export interface Member360 {
  profile: MemberProfile;
  credits: MemberCredits;
  attendance: { attended: number; no_show: number; late_cancel: number };
  upcoming_bookings: MemberBooking[];
  past_bookings: MemberBooking[];
  checkins: MemberVisit[];
  notes: MemberNote[];
}

export interface ProfileInput {
  name: string;
  phone: string;
  email: string;
  birth_date: string;
  emergency_contact: EmergencyContact | null;
}

export interface Branch {
  id: string;
  name: string;
}

/** Penolakan API yang menyebut field dan, untuk data ganda, member pemiliknya. */
export class MemberApiError extends Error {
  constructor(
    message: string,
    readonly field?: string,
    readonly memberId?: string
  ) {
    super(message);
  }
}

/** send() yang menyimpan details.field dan details.member_id dari penolakan. */
async function sendWithDetails<T>(url: string, body: unknown, method: string): Promise<T> {
  const res = await fetch(url, {
    method,
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.success) {
    throw new MemberApiError(json.error || "Permintaan gagal", json.details?.field, json.details?.member_id);
  }
  return json.data as T;
}

export const MEMBER_KEYS = {
  all: ["gym-members"] as const,
  list: (query: string) => ["gym-members", "list", query] as const,
  detail: (id: string) => ["gym-members", "detail", id] as const,
  branches: ["gym-members", "branches"] as const,
};

export const membersApi = {
  list: (query: string) => call<MemberPage>(`/api/gym/members?${query}`),
  detail: (id: string) => call<Member360>(`/api/gym/members/${id}`),
  register: (input: { name: string; phone: string; email: string }) =>
    sendWithDetails<{ id: string }>("/api/gym/members", input, "POST"),
  update: (id: string, input: ProfileInput) => sendWithDetails<{ id: string }>(`/api/gym/members/${id}`, input, "PATCH"),
  addNote: (id: string, body: string) => send<MemberNote>(`/api/gym/members/${id}/notes`, { body }),
  deleteNote: (id: string, noteId: string) => remove(`/api/gym/members/${id}/notes/${noteId}`),
  branches: () => call<Branch[]>("/api/gym/reports/branches"),
};
