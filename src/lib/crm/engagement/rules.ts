/**
 * Aturan engagement member, port dari domain NüHabit (packages/domain:
 * qr.ts, booking.ts, challenges). Murni tanpa I/O supaya bisa dites.
 */

/** "Sen, 5 Okt, 15.00" dalam WIB — dipakai notifikasi, dashboard, dan portal. */
export const formatWib = (iso: string | Date) =>
  new Date(iso).toLocaleString("id-ID", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Jakarta",
  });

/* ── QR check-in ─────────────────────────────────────────────────────────
 * QR berisi kredensial acak sekali pakai yang cepat kedaluwarsa, BUKAN ID
 * member: tangkapan layar tidak berguna setelah TTL dan tidak bisa ditelusuri
 * balik ke identitas. */

export const QR_TOKEN_PREFIX = "nhqr_";
/** Prefix sebelum rename NüHabit; QR yang sudah terbit tetap dikenali sampai TTL habis. */
export const LEGACY_QR_TOKEN_PREFIX = "bcdqr_";
export const QR_TTL_SECONDS = 60;

export type QrProblem = "not_found" | "expired" | "consumed";

export function isMemberQrToken(value: string): boolean {
  const token = value.trim().toLowerCase();
  return token.startsWith(QR_TOKEN_PREFIX) || token.startsWith(LEGACY_QR_TOKEN_PREFIX);
}

export function checkQrToken(
  token: { expires_at: Date | string; consumed_at: Date | string | null } | null,
  now: Date
): QrProblem | null {
  if (!token) return "not_found";
  if (token.consumed_at) return "consumed";
  if (new Date(token.expires_at).getTime() < now.getTime()) return "expired";
  return null;
}

export const QR_PROBLEM_LABEL: Record<QrProblem, string> = {
  not_found: "QR tidak dikenal",
  expired: "QR kedaluwarsa, minta member membuka ulang kartunya",
  consumed: "QR sudah dipakai",
};

/* ── Booking event ───────────────────────────────────────────────────── */

export type BookingDenial =
  | "event_not_open"
  | "booking_closed"
  | "event_started"
  | "already_booked";

export type BookingDecision =
  | { kind: "confirm" }
  | { kind: "waitlist"; position: number }
  | { kind: "deny"; reason: BookingDenial };

export interface BookableEvent {
  status: string;
  starts_at: Date | string;
  capacity: number;
  booking_closes_hours: number;
}

export function bookingClosesAt(event: BookableEvent): Date {
  return new Date(new Date(event.starts_at).getTime() - event.booking_closes_hours * 3_600_000);
}

export function evaluateBooking(args: {
  event: BookableEvent;
  confirmedCount: number;
  lastWaitlistPosition: number;
  hasActiveBooking: boolean;
  now: Date;
}): BookingDecision {
  const { event, now } = args;
  if (event.status !== "published") return { kind: "deny", reason: "event_not_open" };
  if (new Date(event.starts_at).getTime() <= now.getTime()) return { kind: "deny", reason: "event_started" };
  if (bookingClosesAt(event).getTime() <= now.getTime()) return { kind: "deny", reason: "booking_closed" };
  if (args.hasActiveBooking) return { kind: "deny", reason: "already_booked" };
  if (args.confirmedCount >= event.capacity) {
    return { kind: "waitlist", position: args.lastWaitlistPosition + 1 };
  }
  return { kind: "confirm" };
}

export const BOOKING_DENIAL_LABEL: Record<BookingDenial, string> = {
  event_not_open: "Event ini belum dibuka atau sudah dibatalkan",
  booking_closed: "Pendaftaran event ini sudah ditutup",
  event_started: "Event ini sudah dimulai",
  already_booked: "Anda sudah terdaftar di event ini",
};

/** Batal setelah tenggat = batal terlambat (dicatat untuk staf). */
export function isLateCancel(
  event: { starts_at: Date | string; cancel_deadline_hours: number },
  now: Date
): boolean {
  const deadline = new Date(event.starts_at).getTime() - event.cancel_deadline_hours * 3_600_000;
  return now.getTime() > deadline;
}

/** FIFO: posisi terkecil menang; seri dipecah oleh waktu daftar. */
export function pickWaitlistPromotion<
  T extends { status: string; waitlist_position: number | null; created_at: Date | string },
>(bookings: readonly T[]): T | null {
  const waiting = bookings.filter((b) => b.status === "waitlist");
  if (waiting.length === 0) return null;
  return [...waiting].sort(
    (a, b) =>
      (a.waitlist_position ?? Number.MAX_SAFE_INTEGER) - (b.waitlist_position ?? Number.MAX_SAFE_INTEGER) ||
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  )[0];
}

/* ── Challenge ───────────────────────────────────────────────────────── */

export type ChallengeMetric = "visits" | "spend";

export const CHALLENGE_METRIC_LABEL: Record<ChallengeMetric, string> = {
  visits: "Kunjungan",
  spend: "Belanja (Rp)",
};

export function challengeProgress(value: number, target: number) {
  const pct = target > 0 ? Math.min(100, (value / target) * 100) : 0;
  return { value, target, pct, completed: value >= target };
}

export type ChallengePhase = "upcoming" | "running" | "ended";

export function challengePhase(
  challenge: { starts_at: Date | string; ends_at: Date | string },
  now: Date
): ChallengePhase {
  if (now.getTime() < new Date(challenge.starts_at).getTime()) return "upcoming";
  if (now.getTime() > new Date(challenge.ends_at).getTime()) return "ended";
  return "running";
}

/** Nama di papan peringkat: nama depan + inisial belakang, demi privasi. */
export function leaderboardName(name: string | null): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "Member";
  return parts.length === 1 ? parts[0] : `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

/* ── Audiens pengumuman ──────────────────────────────────────────────── */

export interface AnnouncementAudience {
  tier_codes?: string[];
  min_visits?: number;
  inactive_days?: number;
}

/** WHERE + params untuk member pos.pos_customers (alias c) sesuai audiens. */
export function audienceWhere(audience: AnnouncementAudience): { sql: string; params: unknown[] } {
  const clauses: string[] = ["c.is_active IS NOT FALSE"];
  const params: unknown[] = [];
  if (audience.tier_codes && audience.tier_codes.length > 0) {
    // Tier dihitung dari XP seperti di portal; kolom membership_tier bisa basi.
    params.push(audience.tier_codes);
    clauses.push(
      `(SELECT t.code FROM crm.crm_membership_tiers t
         WHERE t.is_active AND t.min_lifetime_xp <= COALESCE(c.total_xp, 0)
         ORDER BY t.min_lifetime_xp DESC LIMIT 1) = ANY($${params.length})`
    );
  }
  if (audience.min_visits && audience.min_visits > 0) {
    params.push(audience.min_visits);
    clauses.push(`COALESCE(c.visit_count, 0) >= $${params.length}`);
  }
  if (audience.inactive_days && audience.inactive_days > 0) {
    params.push(audience.inactive_days);
    clauses.push(`(c.last_visit IS NULL OR c.last_visit < now() - make_interval(days => $${params.length}))`);
  }
  return { sql: clauses.join(" AND "), params };
}
