import { CHECKIN_EARLY_MIN, CHECKIN_LATE_MIN } from "@/lib/gym/booking";
import type { PromoDiscountType } from "@/lib/promo/promo";
import { raceImagePath } from "./workout";

/**
 * Aturan murni layar beranda, QR, dan notifikasi aplikasi member
 * (port apps/member NüHabit).
 */

/** Ikon notifikasi referensi (MemberNotificationType) untuk jenis notifikasi di sini. */
export type NotificationKind =
  | "BOOKING_CONFIRMED"
  | "BOOKING_REMINDER"
  | "WAITLIST_PROMOTED"
  | "LOW_BALANCE"
  | "CREDIT_EXPIRY"
  | "VISIT_LOGGED"
  | "SESSION_CHANGED"
  | "ANNOUNCEMENT"
  | "OTHER";

export function notificationKind(type: string): NotificationKind {
  const t = type.replace(/^gym_/, "");
  if (t === "booking_confirmed") return "BOOKING_CONFIRMED";
  if (t.includes("reminder")) return "BOOKING_REMINDER";
  if (t.startsWith("waitlist_") || t === "booking_waitlist") return "WAITLIST_PROMOTED";
  if (t.includes("low_balance")) return "LOW_BALANCE";
  if (t.includes("expir")) return "CREDIT_EXPIRY";
  if (t === "checked_in" || t === "visit_recorded") return "VISIT_LOGGED";
  if (t.endsWith("_cancelled") || t.endsWith("_moved")) return "SESSION_CHANGED";
  if (t === "announcement" || t === "promo") return "ANNOUNCEMENT";
  return "OTHER";
}

/** Label diskon promo, mis. "10% OFF" atau "Rp100.000 OFF". */
export function promoLabel(discountType: PromoDiscountType, value: number): string {
  return discountType === "percent" ? `${value}% OFF` : `Rp${Math.round(value).toLocaleString("id-ID")} OFF`;
}

const wibDay = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });

/**
 * Rel "di studio": kelas hari ini (WIB) yang belum mulai; setelah kelas
 * terakhir hari ini lewat, kelas besok.
 */
export function pickRailDay<T extends { startsAt: string | Date }>(
  sessions: T[],
  now: Date
): { railDay: "TODAY" | "TOMORROW"; sessions: T[] } {
  const upcoming = sessions.filter((s) => new Date(s.startsAt).getTime() > now.getTime());
  const today = upcoming.filter((s) => wibDay(new Date(s.startsAt)) === wibDay(now));
  if (today.length > 0) return { railDay: "TODAY", sessions: today };
  const tomorrow = wibDay(new Date(now.getTime() + 86_400_000));
  return { railDay: "TOMORROW", sessions: upcoming.filter((s) => wibDay(new Date(s.startsAt)) === tomorrow) };
}

export interface GateBookingCandidate {
  booking: { status: string };
  session: { startsAt: string; endsAt: string };
}

/**
 * Booking yang meloloskan member di gate sekarang (jendela check-in memuat
 * `now`), selain itu booking terkonfirmasi berikutnya.
 */
export function pickGateBooking<T extends GateBookingCandidate>(
  bookings: T[],
  now: number
): { booking: T; live: boolean } | null {
  const confirmed = bookings
    .filter((b) => b.booking.status === "CONFIRMED" || b.booking.status === "CHECKED_IN")
    .sort((a, b) => new Date(a.session.startsAt).getTime() - new Date(b.session.startsAt).getTime());
  const live = confirmed.find(
    (b) =>
      new Date(b.session.startsAt).getTime() - CHECKIN_EARLY_MIN * 60_000 <= now &&
      now <= new Date(b.session.endsAt).getTime() + CHECKIN_LATE_MIN * 60_000
  );
  if (live) return { booking: live, live: true };
  const next = confirmed.find(
    (b) => b.booking.status === "CONFIRMED" && new Date(b.session.startsAt).getTime() > now
  );
  return next ? { booking: next, live: false } : null;
}

/** Foto race: gambar dari admin, atau foto kota bawaan aplikasi. */
export function raceImage(imageUrl: string | null, city: string): string | null {
  if (imageUrl) return imageUrl;
  const path = raceImagePath(city);
  return path && `/member-assets${path}`;
}

/** Versi teks waiver digital yang disetujui member saat mendaftar. */
export const WAIVER_VERSION = "1.0";
