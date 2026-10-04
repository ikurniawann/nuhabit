/** Klien API Gym → jadwal kelas, sesi, booking, jenis kelas, coach, check-in. */
import type { BookingStatus, GateDenialReason, SessionStatus } from "@/lib/gym/booking";
import { formatTime } from "@/lib/format";
import { call, send } from "../shared";

export interface ClassType {
  id: string;
  name: string;
  description: string;
  default_duration_min: number;
  default_credit_cost: number;
  default_capacity: number;
  color: ClassColor;
  status: "active" | "archived";
  upcoming_sessions: number;
}

export type ClassColor = "lime" | "info" | "warning" | "danger" | "success" | "ink";
export type ClassTypeInput = Omit<ClassType, "id" | "upcoming_sessions">;

export interface Coach {
  id: string;
  name: string;
  bio: string;
  specialization: string;
  photo_url: string | null;
  branch_id: string | null;
  branch_name: string | null;
  status: "active" | "inactive";
  upcoming_sessions: number;
  completed_sessions: number;
}

export type CoachInput = Pick<Coach, "name" | "bio" | "specialization" | "photo_url" | "status">;

export interface Session {
  id: string;
  class_type_id: string;
  class_type_name: string;
  color: ClassColor;
  coach_id: string | null;
  coach_name: string | null;
  branch_id: string | null;
  area: string | null;
  starts_at: string;
  ends_at: string;
  capacity: number;
  credit_cost: number;
  booking_opens_at: string;
  booking_closes_at: string;
  status: SessionStatus;
  notes: string | null;
  confirmed_count: number;
  waitlist_count: number;
  checked_in_count: number;
  seats_left: number;
}

export interface SessionInput {
  class_type_id: string;
  coach_id: string | null;
  area: string | null;
  starts_at: string;
  duration_min?: number | null;
  capacity?: number | null;
  credit_cost?: number | null;
  notes?: string | null;
  publish: boolean;
}

export interface RosterEntry {
  id: string;
  customer_id: string;
  name: string | null;
  phone: string;
  status: BookingStatus;
  waitlist_position: number | null;
  source: "member" | "admin";
  late_cancel: boolean;
  promotion_offered_at: string | null;
  checked_in_at: string | null;
}

export interface BookingRow {
  id: string;
  status: BookingStatus;
  waitlist_position: number | null;
  source: "member" | "admin";
  late_cancel: boolean;
  checked_in_at: string | null;
  created_at: string;
  customer_id: string;
  member_name: string | null;
  member_phone: string;
  session_id: string;
  starts_at: string;
  credit_cost: number;
  class_type_name: string;
  coach_name: string | null;
}

export interface MemberHit {
  id: string;
  name: string | null;
  phone: string;
  is_active: boolean;
  credits: number;
}

export interface CheckInResult {
  decision: "allowed" | "denied";
  reason: GateDenialReason | null;
  entryKind: "booking" | "re_entry" | null;
  message: string;
  memberName: string | null;
  creditsDeducted: number;
  balanceAfter: number | null;
}

export interface AccessLogRow {
  id: string;
  decision: "allowed" | "denied";
  reason: GateDenialReason | null;
  entry_kind: "booking" | "re_entry" | null;
  credit_delta: number;
  source: "gate" | "pos" | "manual";
  created_at: string;
  member_name: string | null;
  member_phone: string | null;
  class_type_name: string | null;
  starts_at: string | null;
  staff_name: string | null;
}

const qs = (params: Record<string, string | undefined>) =>
  new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => Boolean(e[1]))).toString();

export const schedulingApi = {
  classTypes: () => call<ClassType[]>("/api/gym/class-types"),
  saveClassType: (input: ClassTypeInput, id?: string) =>
    id ? send<{ id: string }>(`/api/gym/class-types/${id}`, input, "PATCH") : send<{ id: string }>("/api/gym/class-types", input),
  archiveClassType: (id: string) => call<{ id: string }>(`/api/gym/class-types/${id}`, { method: "DELETE" }),

  coaches: () => call<Coach[]>("/api/gym/coaches"),
  saveCoach: (input: CoachInput, id?: string) =>
    id ? send<{ id: string }>(`/api/gym/coaches/${id}`, input, "PATCH") : send<{ id: string }>("/api/gym/coaches", input),

  sessions: (params: { from: string; to: string; status?: string; class_type_id?: string; coach_id?: string }) =>
    call<Session[]>(`/api/gym/sessions?${qs(params)}`),
  createSession: (input: SessionInput) => send<{ id: string }>("/api/gym/sessions", input),
  updateSession: (id: string, patch: Partial<SessionInput>) => send<{ id: string }>(`/api/gym/sessions/${id}`, patch, "PATCH"),
  session: (id: string) => call<{ session: Session; roster: RosterEntry[] }>(`/api/gym/sessions/${id}`),
  sessionAction: (id: string, action: "publish" | "cancel" | "complete") =>
    send<{ notified?: number; completed?: number; noShows?: number; penaltyCredits?: number }>(
      `/api/gym/sessions/${id}`,
      { action }
    ),
  deleteSession: (id: string) => call<{ id: string }>(`/api/gym/sessions/${id}`, { method: "DELETE" }),
  duplicateWeek: (input: { source_week: string; target_week: string; publish: boolean }) =>
    send<{ created: number; skipped: number }>("/api/gym/sessions/duplicate-week", input),

  bookings: (params: { from: string; to: string; status?: string; q?: string; session_id?: string }) =>
    call<BookingRow[]>(`/api/gym/bookings?${qs(params)}`),
  book: (sessionId: string, customerId: string) =>
    send<{ status: "confirmed" | "waitlist"; waitlistPosition: number | null }>("/api/gym/bookings", {
      session_id: sessionId,
      customer_id: customerId,
    }),
  bookingAction: (id: string, action: "cancel" | "no_show" | "check_in") =>
    send<{ penaltyCredits?: number; late?: boolean; message?: string }>(`/api/gym/bookings/${id}`, { action }),
  searchMembers: (q: string) => call<MemberHit[]>(`/api/gym/bookings/members?${qs({ q })}`),

  checkinLog: () =>
    call<{ log: AccessLogRow[]; today: { checked_in: number; denied: number; credits: number } }>("/api/gym/checkin"),
  scan: (token: string) => send<CheckInResult>("/api/gym/checkin", { token }),
};

export const GYM_KEYS = {
  sessions: ["gym", "sessions"],
  classTypes: ["gym", "class-types"],
  coaches: ["gym", "coaches"],
  bookings: ["gym", "bookings"],
  checkin: ["gym", "checkin"],
} as const;

/* ── Label & format ──────────────────────────────────────────────────── */

/** "Sen, 5 Okt" (WIB). Jadwal kelas butuh nama hari, jadi tidak memakai formatDate. */
export const tanggal = (iso: string) =>
  new Date(iso).toLocaleDateString("id-ID", { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Jakarta" });
/** "Sen, 5 Okt, 14.30" (WIB). */
export const waktu = (iso: string) => `${tanggal(iso)}, ${formatTime(iso)}`;

/** "YYYY-MM-DD" (WIB) → ISO awal hari WIB. */
export const wibDayStart = (day: string) => new Date(`${day}T00:00:00+07:00`).toISOString();
/** Geser "YYYY-MM-DD" sejumlah hari. */
export const addDays = (day: string, days: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
/** Hari WIB ("YYYY-MM-DD") dari sebuah instan. */
export const wibDay = (iso: string | Date) =>
  new Date(new Date(iso).getTime() + 7 * 3_600_000).toISOString().slice(0, 10);
/** Jam WIB ("HH:MM", nilai <input type="time">) dari sebuah instan. */
export const wibTime = (iso: string | Date) =>
  new Date(new Date(iso).getTime() + 7 * 3_600_000).toISOString().slice(11, 16);

export const SESSION_BADGE: Record<
  SessionStatus,
  { label: string; variant: "outline" | "success" | "warning" | "muted" | "secondary" }
> = {
  draft: { label: "Draf", variant: "outline" },
  published: { label: "Terbit", variant: "success" },
  full: { label: "Penuh", variant: "warning" },
  completed: { label: "Selesai", variant: "secondary" },
  cancelled: { label: "Dibatalkan", variant: "muted" },
};

export const BOOKING_BADGE: Record<
  BookingStatus,
  { label: string; variant: "ink" | "info" | "success" | "destructive" | "muted" | "secondary" }
> = {
  confirmed: { label: "Terdaftar", variant: "ink" },
  waitlist: { label: "Waitlist", variant: "info" },
  checked_in: { label: "Check-in", variant: "success" },
  completed: { label: "Hadir", variant: "secondary" },
  no_show: { label: "Tidak hadir", variant: "destructive" },
  cancelled: { label: "Batal", variant: "muted" },
};

/** Garis warna jenis kelas di kartu jadwal (token semantik, bukan hex). */
export const CLASS_COLOR: Record<ClassColor, { bar: string; label: string }> = {
  lime: { bar: "bg-forest", label: "Hijau" },
  info: { bar: "bg-info", label: "Biru" },
  warning: { bar: "bg-warning", label: "Kuning" },
  danger: { bar: "bg-danger", label: "Merah" },
  success: { bar: "bg-success", label: "Mint" },
  ink: { bar: "bg-ink", label: "Hitam" },
};
