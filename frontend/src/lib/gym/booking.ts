/**
 * Aturan jadwal kelas, booking, dan gate check-in gym. Port dari domain
 * NüHabit (packages/domain: classes.ts, booking.ts, access.ts, qr.ts).
 * Murni tanpa I/O supaya setiap aturan bisa dites.
 *
 * Kredit dicek saat booking tetapi baru DIPOTONG saat check-in. Member yang
 * booking lalu tidak datang ditangani kebijakan no-show, bukan bayar dua kali.
 */

/* ── Aturan yang dipakai modul ini ─────────────────────────────────────
 * Subset dari GymRules (src/lib/gym/rules.ts); ditulis ulang di sini agar
 * domain tidak bergantung pada modul server. */

export type CreditPolicy = "forfeit" | "free";

export interface SchedulingRules {
  cancellationDeadlineHours: number;
  lateCancelPolicy: CreditPolicy;
  noShowPolicy: CreditPolicy;
  reEntryGraceMin: number;
  antiPassbackMin: number;
  waitlistAutoPromote: boolean;
  bookingOpensDaysBefore: number;
  bookingClosesMinBefore: number;
}

type Instant = Date | string;
const ms = (value: Instant) => new Date(value).getTime();
const MINUTE = 60_000;

/* ── Sesi ────────────────────────────────────────────────────────────── */

export const SESSION_STATUSES = ["draft", "published", "full", "completed", "cancelled"] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

export const SESSION_TRANSITIONS: Record<SessionStatus, readonly SessionStatus[]> = {
  draft: ["published", "cancelled"],
  published: ["full", "completed", "cancelled"],
  full: ["published", "completed", "cancelled"],
  completed: [],
  cancelled: [],
};

export const canTransitionSession = (from: SessionStatus, to: SessionStatus) =>
  SESSION_TRANSITIONS[from].includes(to);

/** Sesi yang bisa di-booking member. */
export const BOOKABLE_SESSION_STATUSES: readonly SessionStatus[] = ["published", "full"];

/** Jendela booking diturunkan dari jam mulai dan aturan cabang. */
export function deriveBookingWindow(
  startsAt: Instant,
  rules: Pick<SchedulingRules, "bookingOpensDaysBefore" | "bookingClosesMinBefore">
): { opensAt: Date; closesAt: Date } {
  const start = ms(startsAt);
  return {
    opensAt: new Date(start - rules.bookingOpensDaysBefore * 24 * 60 * MINUTE),
    closesAt: new Date(start - rules.bookingClosesMinBefore * MINUTE),
  };
}

/**
 * Status sesi setelah jumlah kursi terisi berubah: penuh saat kursi terakhir
 * terisi, kembali terbit saat ada kursi lepas. Status lain tidak tersentuh.
 */
export function sessionStatusForSeats(status: SessionStatus, confirmedCount: number, capacity: number): SessionStatus {
  if (status === "published" && confirmedCount >= capacity) return "full";
  if (status === "full" && confirmedCount < capacity) return "published";
  return status;
}

/* ── Booking ─────────────────────────────────────────────────────────── */

export const BOOKING_STATUSES = ["confirmed", "waitlist", "cancelled", "checked_in", "completed", "no_show"] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export const BOOKING_TRANSITIONS: Record<BookingStatus, readonly BookingStatus[]> = {
  confirmed: ["cancelled", "checked_in", "no_show"],
  waitlist: ["confirmed", "cancelled"],
  checked_in: ["completed"],
  cancelled: [],
  completed: [],
  no_show: [],
};

export const canTransitionBooking = (from: BookingStatus, to: BookingStatus) =>
  BOOKING_TRANSITIONS[from].includes(to);

/** Booking yang masih memegang kursi atau tempat di waitlist. */
export const ACTIVE_BOOKING_STATUSES: readonly BookingStatus[] = ["confirmed", "waitlist", "checked_in"];

export type BookingDenialReason =
  | "member_not_active"
  | "session_not_bookable"
  | "booking_not_open_yet"
  | "booking_window_closed"
  | "already_booked"
  | "insufficient_credits";

export const BOOKING_DENIAL_LABEL: Record<BookingDenialReason, string> = {
  member_not_active: "Keanggotaan ini belum bisa booking kelas",
  session_not_bookable: "Kelas ini tidak dibuka untuk booking",
  booking_not_open_yet: "Booking kelas ini belum dibuka",
  booking_window_closed: "Booking kelas ini sudah ditutup",
  already_booked: "Anda sudah punya tempat di kelas ini",
  insufficient_credits: "Kredit tidak cukup untuk kelas ini",
};

export type BookingDecision =
  | { kind: "confirm" }
  | { kind: "waitlist"; position: number }
  | { kind: "deny"; reason: BookingDenialReason };

export interface BookableSession {
  status: SessionStatus;
  capacity: number;
  credit_cost: number;
  booking_opens_at: Instant;
  booking_closes_at: Instant;
}

/**
 * Urutan cek mengikuti referensi: member aktif → sesi terbit/penuh → jendela
 * booking → belum punya booking aktif → saldo cukup → kursi atau waitlist.
 */
export function evaluateBookingEligibility(args: {
  memberActive: boolean;
  session: BookableSession;
  balance: number;
  confirmedCount: number;
  lastWaitlistPosition: number;
  hasActiveBooking: boolean;
  now: Date;
}): BookingDecision {
  const { session, now } = args;
  if (!args.memberActive) return { kind: "deny", reason: "member_not_active" };
  if (!BOOKABLE_SESSION_STATUSES.includes(session.status)) return { kind: "deny", reason: "session_not_bookable" };
  if (now.getTime() < ms(session.booking_opens_at)) return { kind: "deny", reason: "booking_not_open_yet" };
  if (now.getTime() > ms(session.booking_closes_at)) return { kind: "deny", reason: "booking_window_closed" };
  if (args.hasActiveBooking) return { kind: "deny", reason: "already_booked" };
  if (args.balance < session.credit_cost) return { kind: "deny", reason: "insufficient_credits" };
  if (args.confirmedCount >= session.capacity) return { kind: "waitlist", position: args.lastWaitlistPosition + 1 };
  return { kind: "confirm" };
}

/* ── Pembatalan & no-show ────────────────────────────────────────────── */

export function cancellationDeadline(startsAt: Instant, rules: Pick<SchedulingRules, "cancellationDeadlineHours">) {
  return new Date(ms(startsAt) - rules.cancellationDeadlineHours * 60 * MINUTE);
}

export interface CancellationOutcome {
  /** Lewat batas batal gratis. */
  late: boolean;
  deadline: Date;
  /** Kredit yang hangus (dipotong) karena batal terlambat. */
  penaltyCredits: number;
}

/**
 * Batal sebelum batas gratis. Setelahnya "batal terlambat": kredit sesi hangus
 * bila kebijakan forfeit. Melepas tempat waitlist selalu gratis.
 */
export function evaluateCancellation(args: {
  bookingStatus: BookingStatus;
  startsAt: Instant;
  creditCost: number;
  rules: Pick<SchedulingRules, "cancellationDeadlineHours" | "lateCancelPolicy">;
  now: Date;
}): CancellationOutcome {
  const deadline = cancellationDeadline(args.startsAt, args.rules);
  const late = args.bookingStatus === "confirmed" && args.now.getTime() > deadline.getTime();
  return {
    late,
    deadline,
    penaltyCredits: late && args.rules.lateCancelPolicy === "forfeit" ? args.creditCost : 0,
  };
}

export const noShowPenalty = (creditCost: number, rules: Pick<SchedulingRules, "noShowPolicy">) =>
  rules.noShowPolicy === "forfeit" ? creditCost : 0;

/* ── Waitlist ────────────────────────────────────────────────────────── */

export interface WaitlistEntry {
  id: string;
  status: BookingStatus;
  waitlist_position: number | null;
  created_at: Instant;
  promotion_offered_at?: Instant | null;
}

/** FIFO: posisi terkecil menang, seri dipecah waktu daftar. */
export function pickWaitlistPromotion<T extends WaitlistEntry>(rows: readonly T[]): T | null {
  const candidates = rows.filter((b) => b.status === "waitlist" && !b.promotion_offered_at);
  if (candidates.length === 0) return null;
  return [...candidates].sort(
    (a, b) =>
      (a.waitlist_position ?? Number.MAX_SAFE_INTEGER) - (b.waitlist_position ?? Number.MAX_SAFE_INTEGER) ||
      ms(a.created_at) - ms(b.created_at)
  )[0];
}

export function nextWaitlistPosition(rows: readonly WaitlistEntry[]): number {
  return rows
    .filter((b) => b.status === "waitlist")
    .reduce((max, b) => Math.max(max, b.waitlist_position ?? 0), 0) + 1;
}

/**
 * Kursi yang lepas jatuh ke antrean terdepan: langsung terkonfirmasi (auto),
 * atau ditawarkan dan member harus menerimanya (offer).
 */
export function planWaitlistPromotion<T extends WaitlistEntry>(
  rows: readonly T[],
  rules: Pick<SchedulingRules, "waitlistAutoPromote">
): { booking: T; mode: "auto" | "offer" } | null {
  const booking = pickWaitlistPromotion(rows);
  if (!booking) return null;
  return { booking, mode: rules.waitlistAutoPromote ? "auto" : "offer" };
}

/* ── Penutupan sesi ──────────────────────────────────────────────────── */

/**
 * Status akhir tiap booking saat sesi selesai: yang sudah check-in selesai,
 * yang terkonfirmasi tapi tidak datang menjadi no-show, waitlist batal.
 */
export function bookingStatusOnComplete(status: BookingStatus): BookingStatus {
  if (status === "checked_in") return "completed";
  if (status === "confirmed") return "no_show";
  if (status === "waitlist") return "cancelled";
  return status;
}

/* ── Gate check-in ───────────────────────────────────────────────────── */

/** Gate menerima member untuk kelasnya mulai 45 menit sebelum mulai sampai 15 menit setelah selesai. */
export const CHECKIN_EARLY_MIN = 45;
export const CHECKIN_LATE_MIN = 15;

export function isWithinCheckInWindow(session: { starts_at: Instant; ends_at: Instant }, now: Date): boolean {
  const t = now.getTime();
  return t >= ms(session.starts_at) - CHECKIN_EARLY_MIN * MINUTE && t <= ms(session.ends_at) + CHECKIN_LATE_MIN * MINUTE;
}

export type QrTokenProblem = "not_found" | "expired" | "consumed";

export type GateDenialReason =
  | "token_invalid"
  | "token_expired"
  | "token_consumed"
  | "member_not_active"
  | "anti_passback"
  | "no_booking"
  | "insufficient_credits";

export const GATE_DENIAL_LABEL: Record<GateDenialReason, string> = {
  token_invalid: "QR tidak dikenal",
  token_expired: "QR kedaluwarsa, minta member membuka ulang kartunya",
  token_consumed: "QR sudah dipakai",
  member_not_active: "Keanggotaan tidak aktif",
  anti_passback: "Baru saja masuk, tunggu sebelum scan lagi",
  no_booking: "Tidak ada booking kelas",
  insufficient_credits: "Kredit tidak cukup untuk kelas ini",
};

export const TOKEN_DENIAL: Record<QrTokenProblem, GateDenialReason> = {
  not_found: "token_invalid",
  expired: "token_expired",
  consumed: "token_consumed",
};

export type GateEntryKind = "booking" | "re_entry";

export type GateEffect =
  | { kind: "consume_token" }
  | { kind: "deduct_credits"; amount: number }
  | { kind: "check_in_booking"; bookingId: string };

export interface GateScanEvaluation {
  decision: "allowed" | "denied";
  reason: GateDenialReason | null;
  entryKind: GateEntryKind | null;
  effects: GateEffect[];
}

/**
 * Pipeline gate: QR → keanggotaan → re-entry/anti-passback → booking → kredit.
 * Murni: mengembalikan keputusan + daftar efek yang diterapkan server dalam
 * satu transaksi, supaya gate tidak pernah terbuka tanpa potongan kreditnya.
 * Tidak ada open gym: tanpa booking kelas di sekitar sekarang, masuk ditolak.
 * `tokenProblem` undefined berarti token sudah divalidasi pemanggil.
 */
export function evaluateGateScan(args: {
  tokenProblem?: QrTokenProblem | null;
  memberActive: boolean;
  lastAllowedEntryAt: Instant | null;
  candidate: { bookingId: string; creditCost: number } | null;
  balance: number;
  rules: Pick<SchedulingRules, "reEntryGraceMin" | "antiPassbackMin">;
  now: Date;
}): GateScanEvaluation {
  const denied = (reason: GateDenialReason, effects: GateEffect[] = []): GateScanEvaluation => ({
    decision: "denied",
    reason,
    entryKind: null,
    effects,
  });

  // 1. QR sah? Token yang tidak sah tidak dikonsumsi (tidak ada yang bisa dikonsumsi).
  if (args.tokenProblem) return denied(TOKEN_DENIAL[args.tokenProblem]);
  const consume: GateEffect = { kind: "consume_token" };

  // 2. Keanggotaan aktif?
  if (!args.memberActive) return denied("member_not_active", [consume]);

  // 3. Re-entry gratis dalam masa tenggang, lalu anti-passback. Booking yang
  //    belum check-in selalu didahulukan, supaya kelas berurutan tetap tercatat
  //    (dan tidak jatuh jadi no-show).
  if (args.lastAllowedEntryAt !== null && !args.candidate) {
    const minsSince = (args.now.getTime() - ms(args.lastAllowedEntryAt)) / MINUTE;
    if (minsSince >= 0 && minsSince <= args.rules.reEntryGraceMin) {
      return { decision: "allowed", reason: null, entryKind: "re_entry", effects: [consume] };
    }
    if (minsSince >= 0 && minsSince <= args.rules.antiPassbackMin) return denied("anti_passback", [consume]);
  }

  // 4. Wajib booking kelas di sekitar sekarang.
  if (!args.candidate) return denied("no_booking", [consume]);

  // 5. Saldo menutup biaya kelas.
  if (args.balance < args.candidate.creditCost) return denied("insufficient_credits", [consume]);

  return {
    decision: "allowed",
    reason: null,
    entryKind: "booking",
    effects: [
      consume,
      { kind: "deduct_credits", amount: args.candidate.creditCost },
      { kind: "check_in_booking", bookingId: args.candidate.bookingId },
    ],
  };
}

/** Kalimat keputusan gate untuk staf: kenapa masuk, atau kenapa ditolak. */
export function describeGateDecision(
  evaluation: Pick<GateScanEvaluation, "decision" | "reason" | "entryKind">,
  detail: { className?: string | null; credits?: number; balanceAfter?: number | null } = {}
): string {
  if (evaluation.decision === "denied") return GATE_DENIAL_LABEL[evaluation.reason ?? "no_booking"];
  if (evaluation.entryKind === "re_entry") return "Masuk ulang dalam masa tenggang, tanpa potong kredit";
  const parts = [`Check-in ${detail.className ?? "kelas"}`];
  if (detail.credits) parts.push(`${detail.credits} kredit dipotong`);
  if (detail.balanceAfter != null) parts.push(`sisa ${detail.balanceAfter} kredit`);
  return parts.join(" · ");
}

/* ── Minggu jadwal ───────────────────────────────────────────────────── */

/** Senin 00:00 WIB dari minggu yang memuat `date`, sebagai "YYYY-MM-DD". */
export function weekStartWib(date: Date): string {
  const wib = new Date(date.getTime() + 7 * 60 * MINUTE);
  const isoDow = wib.getUTCDay() === 0 ? 7 : wib.getUTCDay();
  wib.setUTCDate(wib.getUTCDate() - (isoDow - 1));
  return wib.toISOString().slice(0, 10);
}

/** Geser jam mulai sesi sejumlah hari (untuk duplikasi minggu). */
export const shiftDays = (value: Instant, days: number) => new Date(ms(value) + days * 24 * 60 * MINUTE);
