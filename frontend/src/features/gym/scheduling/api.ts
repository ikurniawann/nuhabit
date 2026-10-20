/** Klien API Gym → jadwal kelas, sesi, booking, jenis kelas, coach, check-in. */
import type { BookingStatus, GateDenialReason, SessionStatus } from "@/lib/gym/booking";
import { formatTime } from "@/lib/format";
import { call, send, upload } from "../shared";

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
  /** Akun staf coach ini; dipakai untuk akses "kelas sendiri". */
  user_id: string | null;
  user_name: string | null;
  status: "active" | "inactive";
  upcoming_sessions: number;
  completed_sessions: number;
}

export type CoachInput = Pick<Coach, "name" | "bio" | "specialization" | "photo_url" | "status" | "branch_id" | "user_id">;

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
  /** Diisi saat studio memindah jam; member yang sudah booking bisa batal gratis. */
  moved_at: string | null;
  original_starts_at: string | null;
  /** Diisi untuk sesi hasil generate template jadwal. */
  template_id: string | null;
  occurrence_date: string | null;
  confirmed_count: number;
  waitlist_count: number;
  checked_in_count: number;
  no_show_count: number;
  seats_left: number;
}

/** Beban kerja coach: sesi berjalan (terbit, penuh, selesai) minggu dan bulan ini. */
export interface CoachWorkload {
  week_sessions: number;
  month_sessions: number;
  /** Rata-rata kursi terisi per kapasitas (0–1) sebulan; null tanpa sesi. */
  avg_fill: number | null;
}

export interface CoachSchedule {
  /** Senin minggu yang ditampilkan ("YYYY-MM-DD", WIB). */
  week_start: string;
  /** Bulan statistik ("YYYY-MM"). */
  month: string;
  sessions: Session[];
  workload: CoachWorkload;
}

/** Pola mingguan: weekday 1 = Senin … 7 = Minggu, start_time "HH:MM" WIB. */
export interface SessionTemplate {
  id: string;
  class_type_id: string;
  class_type_name: string;
  color: ClassColor;
  coach_id: string | null;
  coach_name: string | null;
  branch_id: string | null;
  branch_name: string | null;
  area: string | null;
  weekday: number;
  start_time: string;
  duration_min: number;
  capacity: number;
  credit_cost: number;
  valid_from: string;
  valid_until: string | null;
  active: boolean;
  upcoming_sessions: number;
  /** Tanggal terakhir yang sudah dibuat sesinya ("YYYY-MM-DD"). */
  generated_until: string | null;
}

export interface SessionTemplateInput {
  class_type_id: string;
  coach_id: string | null;
  branch_id: string | null;
  area: string | null;
  weekday: number;
  start_time: string;
  duration_min: number | null;
  capacity: number | null;
  credit_cost: number | null;
  valid_from: string;
  valid_until: string | null;
  active: boolean;
}

export interface GenerateResult {
  created: number;
  skipped: number;
  conflicts: string[];
}

export interface SessionInput {
  class_type_id: string;
  coach_id: string | null;
  branch_id: string | null;
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
  promotion_expires_at: string | null;
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
  /** Strike pass yang sedang dihitung menuju batas. */
  pass_strikes: number;
  /** Akhir penangguhan booking karena strike; null bila tidak ditangguhkan. */
  suspended_until: string | null;
}

/** Akun staf yang bisa ditautkan ke profil coach. */
export interface StaffUser {
  id: string;
  full_name: string | null;
  email: string | null;
  branch_name: string | null;
}

/** Booking hari ini (WIB) seorang member di pencarian front desk. */
export interface DeskBooking {
  id: string;
  status: BookingStatus;
  session_id: string;
  starts_at: string;
  ends_at: string;
  class_type_name: string;
  coach_name: string | null;
  checked_in_at: string | null;
}

export interface DeskMember {
  id: string;
  name: string | null;
  phone: string;
  is_active: boolean | null;
  member_code: string | null;
  bookings: DeskBooking[];
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
  staffUsers: () => call<StaffUser[]>("/api/gym/coaches/staff"),
  saveCoach: (input: CoachInput, id?: string) =>
    id ? send<{ id: string }>(`/api/gym/coaches/${id}`, input, "PATCH") : send<{ id: string }>("/api/gym/coaches", input),
  /** Unggah foto coach (JPG/PNG/WebP, maks. 5 MB); URL-nya disimpan sebagai photo_url. */
  uploadCoachPhoto: (file: File) => {
    const body = new FormData();
    body.append("file", file);
    return upload<{ url: string }>("/api/gym/coaches/photo", body);
  },
  /** Minggu coach yang memuat `day` ("YYYY-MM-DD", default hari ini) beserta beban kerjanya. */
  coachSchedule: (id: string, day?: string) => call<CoachSchedule>(`/api/gym/coaches/${id}/schedule?${qs({ day })}`),

  sessions: (params: { from: string; to: string; status?: string; class_type_id?: string; coach_id?: string; branch_id?: string }) =>
    call<Session[]>(`/api/gym/sessions?${qs(params)}`),
  createSession: (input: SessionInput) => send<{ id: string }>("/api/gym/sessions", input),
  updateSession: (id: string, patch: Partial<SessionInput>) => send<{ id: string }>(`/api/gym/sessions/${id}`, patch, "PATCH"),
  session: (id: string) => call<{ session: Session; roster: RosterEntry[] }>(`/api/gym/sessions/${id}`),
  sessionAction: (id: string, action: "publish" | "cancel" | "complete") =>
    send<{ notified?: number; refundedCredits?: number; completed?: number; noShows?: number; penaltyCredits?: number }>(
      `/api/gym/sessions/${id}`,
      { action }
    ),
  deleteSession: (id: string) => call<{ id: string }>(`/api/gym/sessions/${id}`, { method: "DELETE" }),
  duplicateWeek: (input: { source_week: string; target_week: string; publish: boolean }) =>
    send<{ created: number; skipped: number }>("/api/gym/sessions/duplicate-week", input),

  templates: () =>
    call<{ templates: SessionTemplate[]; branches: { id: string; name: string }[] }>("/api/gym/session-templates"),
  saveTemplate: (input: SessionTemplateInput, id?: string) =>
    id
      ? send<{ id: string }>(`/api/gym/session-templates/${id}`, input, "PATCH")
      : send<{ id: string }>("/api/gym/session-templates", input),
  setTemplateActive: (id: string, active: boolean) =>
    send<{ id: string }>(`/api/gym/session-templates/${id}`, { active }, "PATCH"),
  deleteTemplate: (id: string) => call<{ id: string }>(`/api/gym/session-templates/${id}`, { method: "DELETE" }),
  generateFromTemplates: () => send<GenerateResult>("/api/gym/session-templates/generate", {}),

  bookings: (params: { from: string; to: string; status?: string; q?: string; session_id?: string }) =>
    call<BookingRow[]>(`/api/gym/bookings?${qs(params)}`),
  /** overrideWindow: walk-in atau terlambat, boleh di luar jendela booking selama sesi belum selesai. */
  book: (sessionId: string, customerId: string, overrideWindow = false) =>
    send<{ bookingId: string; status: "confirmed" | "waitlist"; waitlistPosition: number | null }>("/api/gym/bookings", {
      session_id: sessionId,
      customer_id: customerId,
      override_window: overrideWindow,
    }),
  bookingAction: (id: string, action: "cancel" | "no_show" | "check_in", options?: { waivePenalty?: boolean }) =>
    send<{ penaltyCredits?: number; passStrike?: boolean; late?: boolean; message?: string }>(`/api/gym/bookings/${id}`, {
      action,
      ...(options?.waivePenalty ? { waive_penalty: true } : {}),
    }),
  checkInBooking: (id: string) => send<CheckInResult>(`/api/gym/bookings/${id}`, { action: "check_in" }),
  searchMembers: (q: string) => call<MemberHit[]>(`/api/gym/bookings/members?${qs({ q })}`),

  checkinLog: () =>
    call<{ log: AccessLogRow[]; today: { checked_in: number; denied: number; credits: number } }>("/api/gym/checkin"),
  scan: (token: string, branchId: string | null) => send<CheckInResult>("/api/gym/checkin", { token, branch_id: branchId }),
  deskMembers: (q: string) => call<DeskMember[]>(`/api/gym/checkin/members?${qs({ q })}`),
};

export const GYM_KEYS = {
  sessions: ["gym", "sessions"],
  templates: ["gym", "session-templates"],
  classTypes: ["gym", "class-types"],
  coaches: ["gym", "coaches"],
  bookings: ["gym", "bookings"],
  checkin: ["gym", "checkin"],
  deskMembers: ["gym", "desk-members"],
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

/** Nama hari untuk weekday ISO (1 = Senin … 7 = Minggu). */
export const WEEKDAYS = ["Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu", "Minggu"] as const;

/** Garis warna jenis kelas di kartu jadwal (token semantik, bukan hex). */
export const CLASS_COLOR: Record<ClassColor, { bar: string; label: string }> = {
  lime: { bar: "bg-forest", label: "Hijau" },
  info: { bar: "bg-info", label: "Biru" },
  warning: { bar: "bg-warning", label: "Kuning" },
  danger: { bar: "bg-danger", label: "Merah" },
  success: { bar: "bg-success", label: "Mint" },
  ink: { bar: "bg-ink", label: "Hitam" },
};
