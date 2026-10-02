import type { CoachLevel, ProgramKind, SessionStatus } from "@/lib/studio/schedule";

export interface CoachRow {
  id: string;
  employee_id: string | null;
  full_name: string;
  display_name: string | null;
  level: CoachLevel;
  phone: string | null;
  email: string | null;
  photo_url: string | null;
  bio: string | null;
  certifications: string | null;
  specialties: string[];
  is_public: boolean;
  is_active: boolean;
  sort_order: number;
  employee_name: string | null;
  employee_nip: string | null;
}

export interface EmployeeOption {
  id: string;
  full_name: string;
  nip: string | null;
  phone: string | null;
  email: string | null;
  linked: boolean;
}

export interface ProgramRow {
  id: string;
  code: string;
  name: string;
  kind: ProgramKind;
  description: string | null;
  duration_minutes: number;
  default_capacity: number;
  level_label: string | null;
  is_active: boolean;
  sort_order: number;
}

export interface TemplateRow {
  id: string;
  weekday: number;
  start_time: string;
  end_time: string;
  program_id: string;
  program_name: string;
  program_kind: ProgramKind;
  coach_id: string | null;
  coach_name: string | null;
  coach_level: CoachLevel | null;
  capacity: number;
  notes: string | null;
  is_active: boolean;
}

export interface SessionRow {
  id: string;
  session_date: string;
  start_time: string;
  end_time: string;
  program_id: string;
  program_name: string;
  program_kind: ProgramKind;
  coach_id: string | null;
  coach_name: string | null;
  coach_level: CoachLevel | null;
  capacity: number;
  status: SessionStatus;
  template_id: string | null;
  cancel_reason: string | null;
  notes: string | null;
  booked_count?: number;
  attended_count?: number;
  waitlist_count?: number;
}

export interface RosterRow {
  id: string;
  status: "booked" | "waitlisted" | "cancelled" | "late_cancelled" | "attended" | "no_show";
  source: "front_desk" | "member_app" | "walk_in";
  booked_at: string;
  waitlisted_at: string | null;
  checked_in_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  notes: string | null;
  customer_id: string;
  member_name: string | null;
  member_phone: string;
  photo_url: string | null;
  pass_code: string | null;
  product_name: string | null;
  class_left: number | null;
}

export interface ApiList<T> {
  success: boolean;
  data: T[];
}

export interface ApiMessage {
  success: boolean;
  message?: string;
}

/** "2026-10-05" → "Sen, 5 Okt". */
export function formatDayLabel(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString("id-ID", { weekday: "short", day: "numeric", month: "short" });
}

/** Tanggal hari ini (zona waktu perangkat) sebagai "YYYY-MM-DD". */
export function todayIso(): string {
  const d = new Date();
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}

// ── Member Pass (EPIC-053) ─────────────────────────────────────────────────
export interface PassProductRow {
  id: string;
  code: string;
  name: string;
  category: "class" | "class_pt" | "class_pt_facility" | "pt";
  class_credits: number;
  pt_credits: number;
  facility_access: boolean;
  validity_days: number;
  price: number;
  class_value: number;
  pt_value: number;
  facility_value: number;
  description: string | null;
  is_active: boolean;
  is_public: boolean;
  sort_order: number;
  sold_count?: number;
}

export interface MemberOption {
  id: string;
  name: string | null;
  phone: string;
  email: string | null;
  active_passes?: number;
}

export type EffectivePassStatus = "pending_payment" | "active" | "scheduled" | "expired" | "exhausted" | "cancelled";

export interface PassListRow {
  id: string;
  pass_code: string;
  customer_id: string;
  member_name: string | null;
  member_phone: string;
  product_name: string;
  category: PassProductRow["category"];
  status: string;
  effective_status: EffectivePassStatus;
  class_credits_total: number;
  pt_credits_total: number;
  class_used: number;
  pt_used: number;
  class_left: number;
  pt_left: number;
  facility_access: boolean;
  price_paid: number;
  liability: number;
  valid_from: string;
  valid_until: string;
  frozen_days: number;
  channel: string;
  payment_method: string | null;
  payment_ref: string | null;
  journal_entry_id: string | null;
  notes: string | null;
  cancel_reason: string | null;
  created_at: string;
}

export interface PassLedgerRow {
  id: string;
  entry_type: "issue" | "redeem" | "unredeem" | "adjust" | "expire" | "cancel";
  credit_type: "class" | "pt" | "facility";
  qty: number;
  amount: number;
  note: string | null;
  created_at: string;
  session_date: string | null;
  session_time: string | null;
  program_name: string | null;
  created_by_name: string | null;
}

export interface PassSummary {
  active_passes: number;
  liability: number;
  class_credits_left: number;
  pt_credits_left: number;
  expiring_7d: number;
  due_for_expiry: number;
}

export function rupiah(value: number): string {
  return `Rp ${Math.round(value).toLocaleString("id-ID")}`;
}

export function formatDate(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
}

// ── Personal Training (EPIC-055) ───────────────────────────────────────────
export interface PtCoach {
  id: string;
  full_name: string;
  display_name: string | null;
  level: "coach" | "head_coach";
  photo_url: string | null;
  bio: string | null;
  certifications: string | null;
  specialties: string[];
}

export interface PtProgram {
  id: string;
  code: string;
  name: string;
  description: string | null;
  duration_minutes: number;
  level_label: string | null;
  coaches: PtCoach[];
}

export interface AvailabilityData {
  windows: { id: string; weekday: number; start_time: string; end_time: string; is_active: boolean }[];
  program_ids: string[];
  time_off: { id: string; date_from: string; date_to: string; reason: string | null }[];
}

export interface PtSessionRow {
  session_id: string;
  session_date: string;
  start_time: string;
  end_time: string;
  session_status: "scheduled" | "cancelled" | "completed";
  program_name: string;
  coach_name: string | null;
  booking_id: string | null;
  booking_status: RosterRow["status"] | null;
  source: RosterRow["source"] | null;
  member_name: string | null;
  member_phone: string | null;
  pass_code: string | null;
}
