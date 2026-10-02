/**
 * Logika murni Booking Kelas (EPIC-054) — tanpa DB supaya mudah diuji.
 * Waktu sesi selalu dianggap zona venue (WIB, UTC+7).
 */

export const BOOKING_STATUSES = ["booked", "waitlisted", "cancelled", "late_cancelled", "attended", "no_show"] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];
export const BOOKING_STATUS_LABEL: Record<BookingStatus, string> = {
  booked: "Terdaftar",
  waitlisted: "Waitlist",
  cancelled: "Batal",
  late_cancelled: "Batal telat",
  attended: "Hadir",
  no_show: "Tidak hadir",
};

/** Status yang menempati kursi. */
export const SEAT_STATUSES: BookingStatus[] = ["booked", "attended"];
/** Status yang kreditnya diakui jadi revenue saat kelas diselesaikan. */
export const RECOGNIZE_STATUSES: BookingStatus[] = ["attended", "no_show", "late_cancelled"];

export interface StudioSettings {
  /** Cancel minimal X jam sebelum mulai supaya kredit kembali. */
  cancel_window_hours: number;
  /** Booking dibuka paling jauh X hari ke depan. */
  booking_open_days: number;
  /** Booking ditutup X menit sebelum mulai (0 = sampai kelas mulai). */
  booking_close_minutes: number;
  /** Check-in dibuka X menit sebelum mulai. */
  checkin_open_minutes: number;
  waitlist_enabled: boolean;
  /** Maks booking aktif mendatang per member (0 = tanpa batas). */
  max_active_bookings: number;
}

export const DEFAULT_SETTINGS: StudioSettings = {
  cancel_window_hours: 12,
  booking_open_days: 7,
  booking_close_minutes: 0,
  checkin_open_minutes: 60,
  waitlist_enabled: true,
  max_active_bookings: 0,
};

export const VENUE_UTC_OFFSET = "+07:00";

/** Epoch ms untuk tanggal + jam venue. */
export function sessionEpoch(date: string, time: string): number {
  return new Date(`${date}T${time.slice(0, 5)}:00${VENUE_UTC_OFFSET}`).getTime();
}

/** Cancel tepat waktu (kredit kembali) atau terlambat (kredit hangus). */
export function classifyCancel(nowMs: number, sessionStartMs: number, windowHours: number): "in_time" | "late" {
  return sessionStartMs - nowMs >= windowHours * 3_600_000 ? "in_time" : "late";
}

export type BookWindowCheck = { ok: true } | { ok: false; reason: string };

/** Apakah sesi masih bisa dibooking sekarang (status, jendela buka/tutup). */
export function checkBookingWindow(
  session: { session_date: string; start_time: string; status: string },
  nowMs: number,
  settings: StudioSettings,
  staffOverride = false
): BookWindowCheck {
  if (session.status !== "scheduled") return { ok: false, reason: "Kelas tidak tersedia (dibatalkan/selesai)" };
  const start = sessionEpoch(session.session_date, session.start_time);
  if (nowMs >= start && !staffOverride) return { ok: false, reason: "Kelas sudah dimulai" };
  if (!staffOverride && start - nowMs < settings.booking_close_minutes * 60_000) {
    return { ok: false, reason: `Booking ditutup ${settings.booking_close_minutes} menit sebelum kelas` };
  }
  if (!staffOverride && start - nowMs > settings.booking_open_days * 86_400_000) {
    return { ok: false, reason: `Booking dibuka paling cepat ${settings.booking_open_days} hari sebelum kelas` };
  }
  return { ok: true };
}

export interface PassCandidate {
  id: string;
  status: string;
  valid_from: string;
  valid_until: string;
  class_left: number;
  pt_left: number;
  breakage_recognized: boolean;
}

/**
 * Pilih pass untuk booking: yang berlaku di tanggal sesi dan masih punya
 * kredit; utamakan yang paling cepat berakhir (FEFO) supaya kredit tidak hangus.
 */
export function pickPass<T extends PassCandidate>(passes: T[], sessionDate: string, kind: "class" | "pt" = "class"): T | null {
  const eligible = passes.filter(
    (p) =>
      (p.status === "active" || p.status === "exhausted") &&
      !p.breakage_recognized &&
      p.valid_from <= sessionDate &&
      p.valid_until >= sessionDate &&
      (kind === "class" ? p.class_left : p.pt_left) > 0
  );
  eligible.sort((a, b) => a.valid_until.localeCompare(b.valid_until) || (kind === "class" ? a.class_left - b.class_left : a.pt_left - b.pt_left));
  return eligible[0] ?? null;
}

export function seatsTaken(bookings: { status: BookingStatus }[]): number {
  return bookings.filter((b) => SEAT_STATUSES.includes(b.status)).length;
}

/** Urutan waitlist: siapa yang paling dulu masuk. */
export function waitlistOrder<T extends { status: BookingStatus; waitlisted_at: string | null; booked_at: string }>(bookings: T[]): T[] {
  return bookings
    .filter((b) => b.status === "waitlisted")
    .sort((a, b) => (a.waitlisted_at ?? a.booked_at).localeCompare(b.waitlisted_at ?? b.booked_at));
}

/** Check-in diizinkan dari X menit sebelum mulai sampai kelas selesai. */
export function checkCheckinWindow(
  session: { session_date: string; start_time: string; end_time: string },
  nowMs: number,
  settings: StudioSettings
): BookWindowCheck {
  const start = sessionEpoch(session.session_date, session.start_time);
  const end = sessionEpoch(session.session_date, session.end_time);
  if (nowMs < start - settings.checkin_open_minutes * 60_000) {
    return { ok: false, reason: `Check-in dibuka ${settings.checkin_open_minutes} menit sebelum kelas` };
  }
  if (nowMs > end + 2 * 3_600_000) return { ok: false, reason: "Kelas sudah lewat" };
  return { ok: true };
}

/** Status akhir booking saat kelas diselesaikan. */
export function finalStatus(status: BookingStatus): BookingStatus {
  return status === "booked" ? "no_show" : status;
}
