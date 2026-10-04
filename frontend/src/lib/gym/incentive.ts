/**
 * Insentif coach: honor (IDR) per kelas yang selesai, statement bulanan, dan
 * siklus payout. Terpisah dari kredit member. Port dari
 * packages/domain/src/incentive.ts. Fungsi murni.
 */

/** Tarif satu tipe kelas di sebuah skema. */
export interface SchemeRate {
  classTypeId: string;
  sessionFeeIdr: number;
  perAttendeeIdr: number;
}

export interface IncentiveScheme {
  id: string;
  /** null = skema default organisasi; terisi = skema khusus coach itu. */
  coachId: string | null;
  isDefault: boolean;
  /** Honor tetap per kelas yang selesai. */
  sessionFeeIdr: number;
  /** Per member yang benar-benar hadir. */
  perAttendeeIdr: number;
  /** Bonus bila kehadiran mencapai ambang di bawah. */
  fullClassBonusIdr: number;
  /** mis. 80 → bonus saat hadir ≥ 80% kapasitas. */
  fullClassThresholdPercent: number;
  /** Potongan per no-show; tidak pernah membuat baris di bawah nol. */
  noShowPenaltyIdr: number;
  /** Override per tipe kelas untuk honor sesi dan per peserta. */
  rates: SchemeRate[];
  isActive: boolean;
}

/** Skema khusus coach menang bila ada dan aktif; selain itu skema default. */
export function resolveScheme<S extends IncentiveScheme>(defaultScheme: S, coachOverride: S | null): S {
  return coachOverride && coachOverride.isActive ? coachOverride : defaultScheme;
}

/** Tarif yang dibayar skema untuk satu tipe kelas: override-nya, atau angka skema. */
export function rateFor(scheme: IncentiveScheme, classTypeId: string): SchemeRate {
  return (
    scheme.rates.find((r) => r.classTypeId === classTypeId) ?? {
      classTypeId,
      sessionFeeIdr: scheme.sessionFeeIdr,
      perAttendeeIdr: scheme.perAttendeeIdr,
    }
  );
}

/* ── Periode ─────────────────────────────────────────────────────────── */

export interface StatementPeriod {
  /** ISO, inklusif. */
  start: string;
  /** ISO, eksklusif. */
  end: string;
}

const PERIOD_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

export const isPeriodMonth = (value: string) => PERIOD_RE.test(value);

/** Batas bulan kalender `YYYY-MM` di zona studio (WIB, UTC+7). */
export function monthPeriod(periodMonth: string): StatementPeriod {
  const match = PERIOD_RE.exec(periodMonth);
  if (!match) throw new Error(`Periode tidak valid: ${periodMonth}`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const iso = (y: number, m: number) => new Date(`${y}-${String(m).padStart(2, "0")}-01T00:00:00+07:00`).toISOString();
  return { start: iso(year, month), end: month === 12 ? iso(year + 1, 1) : iso(year, month + 1) };
}

/* ── Statement ───────────────────────────────────────────────────────── */

export type BookingStatus = "confirmed" | "waitlist" | "cancelled" | "checked_in" | "completed" | "no_show";
export type ClassSessionStatus = "draft" | "published" | "full" | "completed" | "cancelled";

export interface StatementSession {
  id: string;
  coachId: string | null;
  classTypeId: string;
  classTypeName: string;
  startsAt: string;
  capacity: number;
  status: ClassSessionStatus;
  bookingStatuses: readonly BookingStatus[];
}

export interface CoachStatementLine {
  sessionId: string;
  startsAt: string;
  classTypeId: string;
  classTypeName: string;
  capacity: number;
  /** Booking yang memegang slot (confirmed, checked in, completed, no-show). */
  booked: number;
  /** Member yang datang (checked_in atau completed). */
  attended: number;
  noShows: number;
  sessionFeeIdr: number;
  attendeeIdr: number;
  bonusIdr: number;
  penaltyIdr: number;
  /** fee + peserta + bonus − potongan, minimal 0. */
  totalIdr: number;
}

export interface CoachStatementTotals {
  sessions: number;
  attended: number;
  noShows: number;
  sessionFeeIdr: number;
  attendeeIdr: number;
  bonusIdr: number;
  penaltyIdr: number;
  totalIdr: number;
}

export interface CoachStatement {
  coachId: string;
  periodMonth: string;
  schemeId: string;
  lines: CoachStatementLine[];
  totals: CoachStatementTotals;
}

const HELD_SLOT: readonly BookingStatus[] = ["confirmed", "checked_in", "completed", "no_show"];
const ATTENDED: readonly BookingStatus[] = ["checked_in", "completed"];

/**
 * Hitung satu baris kelas:
 *   sessionFee + hadir × perAttendee
 *   + (hadir/kapasitas ≥ ambang ? fullClassBonus : 0)
 *   − noShow × penalty, dijepit minimal 0.
 */
export function computeLine(scheme: IncentiveScheme, session: StatementSession): CoachStatementLine {
  const statuses = session.bookingStatuses;
  const booked = statuses.filter((s) => HELD_SLOT.includes(s)).length;
  const attended = statuses.filter((s) => ATTENDED.includes(s)).length;
  const noShows = statuses.filter((s) => s === "no_show").length;
  const rate = rateFor(scheme, session.classTypeId);
  const fillPercent = session.capacity > 0 ? (attended / session.capacity) * 100 : 0;
  const sessionFeeIdr = rate.sessionFeeIdr;
  const attendeeIdr = attended * rate.perAttendeeIdr;
  const bonusIdr = session.capacity > 0 && fillPercent >= scheme.fullClassThresholdPercent ? scheme.fullClassBonusIdr : 0;
  const penaltyIdr = noShows * scheme.noShowPenaltyIdr;
  return {
    sessionId: session.id,
    startsAt: session.startsAt,
    classTypeId: session.classTypeId,
    classTypeName: session.classTypeName,
    capacity: session.capacity,
    booked,
    attended,
    noShows,
    sessionFeeIdr,
    attendeeIdr,
    bonusIdr,
    penaltyIdr,
    totalIdr: Math.max(0, sessionFeeIdr + attendeeIdr + bonusIdr - penaltyIdr),
  };
}

const ZERO_TOTALS: CoachStatementTotals = {
  sessions: 0,
  attended: 0,
  noShows: 0,
  sessionFeeIdr: 0,
  attendeeIdr: 0,
  bonusIdr: 0,
  penaltyIdr: 0,
  totalIdr: 0,
};

/**
 * Statement satu coach untuk satu bulan. Hanya kelas `completed` milik coach
 * itu yang mulai di dalam periode yang dihitung.
 */
export function computeCoachStatement(args: {
  coachId: string;
  periodMonth: string;
  scheme: IncentiveScheme;
  sessions: readonly StatementSession[];
}): CoachStatement {
  const period = monthPeriod(args.periodMonth);
  const start = new Date(period.start).getTime();
  const end = new Date(period.end).getTime();
  const lines = args.sessions
    .filter((s) => {
      const t = new Date(s.startsAt).getTime();
      return s.coachId === args.coachId && s.status === "completed" && t >= start && t < end;
    })
    .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime())
    .map((s) => computeLine(args.scheme, s));

  const totals = lines.reduce<CoachStatementTotals>(
    (acc, l) => ({
      sessions: acc.sessions + 1,
      attended: acc.attended + l.attended,
      noShows: acc.noShows + l.noShows,
      sessionFeeIdr: acc.sessionFeeIdr + l.sessionFeeIdr,
      attendeeIdr: acc.attendeeIdr + l.attendeeIdr,
      bonusIdr: acc.bonusIdr + l.bonusIdr,
      penaltyIdr: acc.penaltyIdr + l.penaltyIdr,
      totalIdr: acc.totalIdr + l.totalIdr,
    }),
    ZERO_TOTALS
  );

  return { coachId: args.coachId, periodMonth: args.periodMonth, schemeId: args.scheme.id, lines, totals };
}

/* ── Payout ──────────────────────────────────────────────────────────── */

export const PAYOUT_STATUSES = ["draft", "approved", "paid", "void"] as const;
export type PayoutStatus = (typeof PAYOUT_STATUSES)[number];

export const PAYOUT_TRANSITIONS: Readonly<Record<PayoutStatus, readonly PayoutStatus[]>> = {
  draft: ["approved", "void"],
  approved: ["paid", "void"],
  paid: [],
  void: [],
};

export const PAYOUT_ACTIONS = ["approve", "pay", "void"] as const;
export type PayoutAction = (typeof PAYOUT_ACTIONS)[number];

export const PAYOUT_ACTION_TARGET: Record<PayoutAction, PayoutStatus> = {
  approve: "approved",
  pay: "paid",
  void: "void",
};

export const PAYOUT_STATUS_LABELS: Record<PayoutStatus, string> = {
  draft: "Draf",
  approved: "Disetujui",
  paid: "Dibayar",
  void: "Dibatalkan",
};

const ACTION_VERBS: Record<PayoutAction, string> = { approve: "disetujui", pay: "dibayar", void: "dibatalkan" };

export type PayoutDecision =
  | { ok: true; status: PayoutStatus; paymentReference: string | null; note: string | null }
  | { ok: false; error: string };

/**
 * Validasi satu aksi admin pada payout. Bayar wajib menyertakan referensi
 * pembayaran; void wajib menyertakan alasan.
 */
export function decidePayoutAction(
  current: PayoutStatus,
  action: PayoutAction,
  input: { paymentReference?: string | null; note?: string | null } = {}
): PayoutDecision {
  const target = PAYOUT_ACTION_TARGET[action];
  if (!PAYOUT_TRANSITIONS[current].includes(target)) {
    return { ok: false, error: `Payout berstatus ${PAYOUT_STATUS_LABELS[current].toLowerCase()} tidak bisa ${ACTION_VERBS[action]}.` };
  }
  const paymentReference = input.paymentReference?.trim() || null;
  const note = input.note?.trim() || null;
  if (action === "pay" && !paymentReference) return { ok: false, error: "Referensi pembayaran wajib diisi." };
  if (action === "void" && !note) return { ok: false, error: "Alasan pembatalan wajib diisi." };
  return { ok: true, status: target, paymentReference, note };
}
