/**
 * Jadwal kelas, booking, dan gate check-in gym di atas PostgreSQL. Aturan
 * murninya di ./booking; modul ini mengumpulkan fakta, lalu menerapkan
 * keputusan dalam transaksi milik pemanggil (setiap fungsi tulis menerima
 * PoolClient dari withTransaction).
 *
 * Kredit tidak dipotong saat booking. Potongan terjadi saat check-in, batal
 * terlambat, atau no-show (kebijakan forfeit), selalu lewat deductCredits.
 */
import type { Pool, PoolClient } from "pg";
import { notifyMember } from "@/lib/crm/engagement/server";
import { checkQrToken, formatWib } from "@/lib/crm/engagement/rules";
import { deductCredits, getCoveredClassTypeIds, getCreditBalance } from "@/lib/gym/credits-server";
import { isClassTypeCovered } from "@/lib/gym/credits";
import { getGymRules } from "@/lib/gym/rules";
import {
  BOOKING_DENIAL_LABEL,
  CHECKIN_EARLY_MIN,
  CHECKIN_LATE_MIN,
  GATE_DENIAL_LABEL,
  TOKEN_DENIAL,
  bookingStatusOnComplete,
  canTransitionBooking,
  canTransitionSession,
  deriveBookingWindow,
  describeGateDecision,
  evaluateBookingEligibility,
  evaluateCancellation,
  evaluateGateScan,
  noShowPenalty,
  planWaitlistPromotion,
  sessionStatusForSeats,
  shiftDays,
  type BookingDenialReason,
  type BookingStatus,
  type CreditPolicy,
  type GateDenialReason,
  type GateEntryKind,
  type SessionStatus,
} from "./booking";

type Db = Pool | PoolClient;

/** Galat bisnis yang aman ditampilkan ke pengguna (route → 4xx). */
export class SchedulingError extends Error {
  constructor(
    message: string,
    readonly status = 409,
    readonly code?: string
  ) {
    super(message);
    this.name = "SchedulingError";
  }
}

/* ── Baca ────────────────────────────────────────────────────────────── */

export interface SessionRow {
  id: string;
  class_type_id: string;
  class_type_name: string;
  color: string;
  coach_id: string | null;
  coach_name: string | null;
  branch_id: string | null;
  area: string | null;
  starts_at: Date;
  ends_at: Date;
  capacity: number;
  credit_cost: number;
  booking_opens_at: Date;
  booking_closes_at: Date;
  status: SessionStatus;
  notes: string | null;
}

export interface SessionSummary extends SessionRow {
  confirmed_count: number;
  waitlist_count: number;
  checked_in_count: number;
  seats_left: number;
  my_booking: { id: string; status: BookingStatus; waitlist_position: number | null; promotion_offered_at: string | null } | null;
}

const SESSION_SELECT = `
  SELECT s.id, s.class_type_id, t.name AS class_type_name, t.color, s.coach_id, c.name AS coach_name,
         s.branch_id, s.area, s.starts_at, s.ends_at, s.capacity, s.credit_cost,
         s.booking_opens_at, s.booking_closes_at, s.status, s.notes
    FROM gym.class_sessions s
    JOIN gym.class_types t ON t.id = s.class_type_id
    LEFT JOIN gym.coaches c ON c.id = s.coach_id`;

/** Kursi terpakai = confirmed + sudah check-in. */
const SEATS_HELD = `status IN ('confirmed', 'checked_in', 'completed')`;

export interface SessionFilter {
  id?: string;
  from?: string | Date;
  to?: string | Date;
  classTypeId?: string;
  coachId?: string;
  branchId?: string;
  statuses?: SessionStatus[];
  /** Sertakan booking aktif member ini di tiap sesi. */
  customerId?: string;
}

export async function listSessions(db: Db, filter: SessionFilter = {}): Promise<SessionSummary[]> {
  const { rows } = await db.query(
    `SELECT x.*,
            COALESCE(k.confirmed, 0)::int AS confirmed_count,
            COALESCE(k.waitlist, 0)::int AS waitlist_count,
            COALESCE(k.checked_in, 0)::int AS checked_in_count,
            GREATEST(x.capacity - COALESCE(k.confirmed, 0), 0)::int AS seats_left,
            CASE WHEN mine.id IS NULL THEN NULL ELSE json_build_object(
              'id', mine.id, 'status', mine.status, 'waitlist_position', mine.waitlist_position,
              'promotion_offered_at', mine.promotion_offered_at) END AS my_booking
       FROM (${SESSION_SELECT}
              WHERE ($1::timestamptz IS NULL OR s.starts_at >= $1)
                AND ($2::timestamptz IS NULL OR s.starts_at < $2)
                AND ($3::uuid IS NULL OR s.class_type_id = $3)
                AND ($4::uuid IS NULL OR s.coach_id = $4)
                AND ($5::uuid IS NULL OR s.branch_id IS NULL OR s.branch_id = $5)
                AND ($6::text[] IS NULL OR s.status = ANY ($6))
                AND ($8::uuid IS NULL OR s.id = $8)
              ORDER BY s.starts_at
              LIMIT 500) x
       LEFT JOIN LATERAL (
         SELECT count(*) FILTER (WHERE b.${SEATS_HELD}) AS confirmed,
                count(*) FILTER (WHERE b.status = 'waitlist') AS waitlist,
                count(*) FILTER (WHERE b.status IN ('checked_in', 'completed')) AS checked_in
           FROM gym.bookings b WHERE b.session_id = x.id
       ) k ON true
       LEFT JOIN LATERAL (
         SELECT b.id, b.status, b.waitlist_position, b.promotion_offered_at FROM gym.bookings b
          WHERE b.session_id = x.id AND b.customer_id = $7 AND b.status <> 'cancelled'
          ORDER BY b.created_at DESC LIMIT 1
       ) mine ON $7::uuid IS NOT NULL
      ORDER BY x.starts_at`,
    [
      filter.from ?? null,
      filter.to ?? null,
      filter.classTypeId ?? null,
      filter.coachId ?? null,
      filter.branchId ?? null,
      filter.statuses ?? null,
      filter.customerId ?? null,
      filter.id ?? null,
    ]
  );
  return rows as SessionSummary[];
}

export async function getSession(db: Db, id: string, customerId?: string): Promise<SessionSummary | null> {
  const [session] = await listSessions(db, { id, customerId });
  return session ?? null;
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
  promotion_offered_at: Date | null;
  checked_in_at: Date | null;
  cancelled_at: Date | null;
  created_at: Date;
}

export async function sessionRoster(db: Db, sessionId: string): Promise<RosterEntry[]> {
  const { rows } = await db.query(
    `SELECT b.id, b.customer_id, c.name, c.phone, b.status, b.waitlist_position, b.source, b.late_cancel,
            b.promotion_offered_at, b.checked_in_at, b.cancelled_at, b.created_at
       FROM gym.bookings b JOIN pos.pos_customers c ON c.id = b.customer_id
      WHERE b.session_id = $1
      ORDER BY CASE b.status WHEN 'checked_in' THEN 0 WHEN 'confirmed' THEN 1 WHEN 'completed' THEN 2
                             WHEN 'waitlist' THEN 3 WHEN 'no_show' THEN 4 ELSE 5 END,
               b.waitlist_position NULLS FIRST, b.created_at`,
    [sessionId]
  );
  return rows as RosterEntry[];
}

export interface CancelInfo {
  deadline: Date;
  /** Batal sekarang = batal terlambat. */
  late: boolean;
  /** Kredit yang hangus bila dibatalkan sekarang. */
  penalty_credits: number;
  policy: CreditPolicy;
}

/**
 * Pratinjau batal untuk portal member: kapan batas gratis dan berapa kredit
 * hangus bila dibatalkan sekarang. Aturan dibaca sekali per cabang.
 */
export async function attachCancelInfo<T extends { branch_id: string | null; starts_at: Date; credit_cost: number }>(
  db: Db,
  rows: T[],
  bookingStatus: (row: T) => BookingStatus | null,
  now = new Date()
): Promise<Array<T & { cancel_info: CancelInfo | null }>> {
  const rulesByBranch = new Map<string | null, Awaited<ReturnType<typeof getGymRules>>>();
  for (const branchId of new Set(rows.map((r) => r.branch_id))) {
    rulesByBranch.set(branchId, await getGymRules(db, branchId));
  }
  return rows.map((row) => {
    const status = bookingStatus(row);
    if (status !== "confirmed") return { ...row, cancel_info: null };
    const rules = rulesByBranch.get(row.branch_id)!;
    const outcome = evaluateCancellation({
      bookingStatus: status,
      startsAt: row.starts_at,
      creditCost: row.credit_cost,
      rules,
      now,
    });
    return {
      ...row,
      cancel_info: {
        deadline: outcome.deadline,
        late: outcome.late,
        penalty_credits: outcome.penaltyCredits,
        policy: rules.lateCancelPolicy,
      },
    };
  });
}

/* ── Internal ────────────────────────────────────────────────────────── */

async function lockSession(client: PoolClient, id: string): Promise<SessionRow> {
  const { rows } = await client.query(`${SESSION_SELECT} WHERE s.id = $1 FOR UPDATE OF s`, [id]);
  if (!rows[0]) throw new SchedulingError("Sesi tidak ditemukan", 404);
  return rows[0] as SessionRow;
}

interface BookingRow {
  id: string;
  session_id: string;
  customer_id: string;
  status: BookingStatus;
  waitlist_position: number | null;
  promotion_offered_at: Date | null;
  created_at: Date;
}

/**
 * Kunci sesi lalu booking-nya, selalu dalam urutan ini (sama dengan
 * bookSession dan completeSession) supaya dua transaksi tidak saling tunggu.
 */
async function lockBookingWithSession(
  client: PoolClient,
  id: string,
  customerId?: string
): Promise<{ booking: BookingRow; session: SessionRow }> {
  const { rows: refs } = await client.query(`SELECT session_id, customer_id FROM gym.bookings WHERE id = $1`, [id]);
  if (!refs[0] || (customerId && refs[0].customer_id !== customerId)) {
    throw new SchedulingError("Booking tidak ditemukan", 404);
  }
  const session = await lockSession(client, refs[0].session_id);
  const { rows } = await client.query(`SELECT * FROM gym.bookings WHERE id = $1 FOR UPDATE`, [id]);
  return { booking: rows[0] as BookingRow, session };
}

async function seatsHeld(client: PoolClient, sessionId: string): Promise<number> {
  const { rows } = await client.query(
    `SELECT count(*)::int AS n FROM gym.bookings WHERE session_id = $1 AND ${SEATS_HELD}`,
    [sessionId]
  );
  return rows[0].n;
}

/** Selaraskan published ↔ full dengan kursi yang terisi sekarang. */
async function syncSessionSeats(client: PoolClient, session: SessionRow): Promise<void> {
  const next = sessionStatusForSeats(session.status, await seatsHeld(client, session.id), session.capacity);
  if (next === session.status) return;
  await client.query(`UPDATE gym.class_sessions SET status = $2, updated_at = now() WHERE id = $1`, [session.id, next]);
  session.status = next;
}

/**
 * Potong kredit hukuman (batal terlambat / no-show). Saldo yang kurang tidak
 * membuat saldo negatif: yang dipotong sebanyak saldo yang ada.
 */
async function chargePenalty(
  client: PoolClient,
  input: { customerId: string; amount: number; sourceType: "late_cancel" | "no_show"; bookingId: string; note: string }
): Promise<number> {
  if (input.amount <= 0) return 0;
  const amount = Math.min(input.amount, await getCreditBalance(client, input.customerId));
  if (amount <= 0) return 0;
  const result = await deductCredits(client, {
    customerId: input.customerId,
    amount,
    sourceType: input.sourceType,
    sourceId: input.bookingId,
    idempotencyKey: `gym:${input.sourceType}:${input.bookingId}`,
    note: input.note,
  });
  return result.ok ? amount : 0;
}

const sessionLabel = (s: Pick<SessionRow, "class_type_name" | "starts_at">) =>
  `${s.class_type_name}, ${formatWib(s.starts_at)}`;

/* ── Booking ─────────────────────────────────────────────────────────── */

export interface BookResult {
  bookingId: string;
  status: "confirmed" | "waitlist";
  waitlistPosition: number | null;
}

/**
 * Ambil kursi atau tempat waitlist. Baris sesi dikunci, jadi dua permintaan
 * untuk kursi terakhir berurutan: satu terkonfirmasi, berikutnya waitlist.
 */
export async function bookSession(
  client: PoolClient,
  input: { customerId: string; sessionId: string; source: "member" | "admin"; now?: Date }
): Promise<BookResult> {
  const now = input.now ?? new Date();
  const session = await lockSession(client, input.sessionId);
  const { rows: members } = await client.query(`SELECT is_active FROM pos.pos_customers WHERE id = $1`, [
    input.customerId,
  ]);
  if (!members[0]) throw new SchedulingError("Member tidak ditemukan", 404);

  const { rows: stats } = await client.query(
    `SELECT count(*) FILTER (WHERE ${SEATS_HELD})::int AS confirmed,
            COALESCE(max(waitlist_position) FILTER (WHERE status = 'waitlist'), 0)::int AS last_waitlist,
            COALESCE(bool_or(customer_id = $2 AND status IN ('confirmed', 'waitlist', 'checked_in')), false) AS mine
       FROM gym.bookings WHERE session_id = $1`,
    [session.id, input.customerId]
  );
  const decision = evaluateBookingEligibility({
    memberActive: members[0].is_active !== false,
    session,
    balance: await getCreditBalance(client, input.customerId),
    confirmedCount: stats[0].confirmed,
    lastWaitlistPosition: stats[0].last_waitlist,
    hasActiveBooking: stats[0].mine,
    now,
  });
  if (decision.kind === "deny") throw denial(decision.reason);
  // Paket bisa membatasi jenis kelas: saldo ada, tapi tidak berlaku untuk kelas ini.
  if (!isClassTypeCovered(await getCoveredClassTypeIds(client, input.customerId), session.class_type_id)) {
    throw new SchedulingError("Paket kredit Anda tidak mencakup kelas ini", 409, "package_not_covered");
  }

  const status = decision.kind === "confirm" ? "confirmed" : "waitlist";
  const position = decision.kind === "waitlist" ? decision.position : null;
  let bookingId: string;
  try {
    const { rows } = await client.query(
      `INSERT INTO gym.bookings (session_id, customer_id, status, waitlist_position, source)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [session.id, input.customerId, status, position, input.source]
    );
    bookingId = rows[0].id;
  } catch (error) {
    if ((error as { code?: string }).code === "23505") throw denial("already_booked");
    throw error;
  }
  if (status === "confirmed") await syncSessionSeats(client, session);

  await notifyMember(
    client,
    input.customerId,
    status === "confirmed"
      ? {
          type: "gym_booking_confirmed",
          title: `Terdaftar: ${session.class_type_name}`,
          body: `Sampai jumpa ${formatWib(session.starts_at)}. ${session.credit_cost} kredit dipotong saat check-in.`,
        }
      : {
          type: "gym_booking_waitlist",
          title: `Masuk waitlist: ${session.class_type_name}`,
          body: `Posisi Anda #${position}. Kami kabari bila ada kursi kosong.`,
        }
  );
  return { bookingId, status, waitlistPosition: position };
}

const denial = (reason: BookingDenialReason) => new SchedulingError(BOOKING_DENIAL_LABEL[reason], 409, reason);

export interface CancelResult {
  late: boolean;
  deadline: Date;
  /** Kredit yang benar-benar dipotong karena batal terlambat. */
  penaltyCredits: number;
  promoted: { customerId: string; mode: "auto" | "offer" } | null;
}

/**
 * Lepas kursi. Batal setelah batas gratis memotong kredit sesi bila
 * kebijakannya forfeit; kursi yang lepas jatuh ke antrean waitlist terdepan.
 * `customerId` diisi saat member membatalkan sendiri (cek kepemilikan).
 */
export async function cancelBooking(
  client: PoolClient,
  input: { bookingId: string; customerId?: string; now?: Date }
): Promise<CancelResult> {
  const now = input.now ?? new Date();
  const { booking, session } = await lockBookingWithSession(client, input.bookingId, input.customerId);
  if (!canTransitionBooking(booking.status, "cancelled")) {
    throw new SchedulingError("Booking ini tidak bisa dibatalkan lagi");
  }
  const rules = await getGymRules(client, session.branch_id);
  const outcome = evaluateCancellation({
    bookingStatus: booking.status,
    startsAt: session.starts_at,
    creditCost: session.credit_cost,
    rules,
    now,
  });

  await client.query(
    `UPDATE gym.bookings
        SET status = 'cancelled', waitlist_position = NULL, promotion_offered_at = NULL,
            late_cancel = $2, cancelled_at = $3, updated_at = now()
      WHERE id = $1`,
    [booking.id, outcome.late, now]
  );
  const penaltyCredits = await chargePenalty(client, {
    customerId: booking.customer_id,
    amount: outcome.penaltyCredits,
    sourceType: "late_cancel",
    bookingId: booking.id,
    note: `Batal terlambat: ${sessionLabel(session)}`,
  });

  let promoted: CancelResult["promoted"] = null;
  if (booking.status === "confirmed") {
    promoted = await promoteWaitlist(client, session, rules.waitlistAutoPromote, now);
    await syncSessionSeats(client, session);
  }

  // Member yang membatalkan sendiri sudah melihat hasilnya di layar.
  if (!input.customerId) {
    await notifyMember(client, booking.customer_id, {
      type: "gym_booking_cancelled",
      title: `Booking dibatalkan: ${session.class_type_name}`,
      body: penaltyCredits
        ? `Booking ${formatWib(session.starts_at)} dibatalkan setelah batas gratis; ${penaltyCredits} kredit hangus.`
        : `Booking ${formatWib(session.starts_at)} dibatalkan.`,
    });
  }
  return { late: outcome.late, deadline: outcome.deadline, penaltyCredits, promoted };
}

/** Berikan kursi yang lepas ke antrean terdepan: langsung (auto) atau ditawarkan (offer). */
async function promoteWaitlist(
  client: PoolClient,
  session: SessionRow,
  autoPromote: boolean,
  now: Date
): Promise<CancelResult["promoted"]> {
  const { rows } = await client.query(
    `SELECT id, customer_id, status, waitlist_position, promotion_offered_at, created_at
       FROM gym.bookings WHERE session_id = $1 AND status = 'waitlist' FOR UPDATE`,
    [session.id]
  );
  const plan = planWaitlistPromotion(rows as Array<BookingRow>, { waitlistAutoPromote: autoPromote });
  if (!plan) return null;
  const { booking, mode } = plan;

  if (mode === "auto") {
    await client.query(
      `UPDATE gym.bookings SET status = 'confirmed', waitlist_position = NULL, updated_at = now() WHERE id = $1`,
      [booking.id]
    );
    await notifyMember(client, booking.customer_id, {
      type: "gym_waitlist_promoted",
      title: `Kursi tersedia: ${session.class_type_name}`,
      body: `Anda naik dari waitlist dan sudah terdaftar untuk ${formatWib(session.starts_at)}.`,
    });
  } else {
    await client.query(`UPDATE gym.bookings SET promotion_offered_at = $2, updated_at = now() WHERE id = $1`, [
      booking.id,
      now,
    ]);
    await notifyMember(client, booking.customer_id, {
      type: "gym_waitlist_offer",
      title: `Kursi ditawarkan: ${session.class_type_name}`,
      body: `Ada kursi kosong untuk ${formatWib(session.starts_at)}. Konfirmasi di portal sebelum diambil member lain.`,
    });
  }
  return { customerId: booking.customer_id, mode };
}

/** Member menerima kursi yang ditawarkan dari waitlist (kebijakan offer). */
export async function confirmWaitlistOffer(
  client: PoolClient,
  input: { bookingId: string; customerId: string }
): Promise<void> {
  const { booking, session } = await lockBookingWithSession(client, input.bookingId, input.customerId);
  if (booking.status !== "waitlist" || !booking.promotion_offered_at) {
    throw new SchedulingError("Belum ada kursi yang ditawarkan untuk Anda di kelas ini");
  }
  if ((await seatsHeld(client, session.id)) >= session.capacity) {
    throw new SchedulingError("Kursi itu sudah diambil member lain");
  }
  await client.query(
    `UPDATE gym.bookings SET status = 'confirmed', waitlist_position = NULL, promotion_offered_at = NULL,
            updated_at = now() WHERE id = $1`,
    [booking.id]
  );
  await syncSessionSeats(client, session);
}

/** Tandai tidak datang; kredit sesi hangus bila kebijakan no-show forfeit. */
export async function markNoShow(client: PoolClient, input: { bookingId: string }): Promise<{ penaltyCredits: number }> {
  const { booking, session } = await lockBookingWithSession(client, input.bookingId);
  if (!canTransitionBooking(booking.status, "no_show")) {
    throw new SchedulingError("Hanya booking terkonfirmasi yang bisa ditandai tidak hadir");
  }
  return { penaltyCredits: await applyNoShow(client, booking, session) };
}

async function applyNoShow(client: PoolClient, booking: BookingRow, session: SessionRow): Promise<number> {
  const rules = await getGymRules(client, session.branch_id);
  await client.query(`UPDATE gym.bookings SET status = 'no_show', updated_at = now() WHERE id = $1`, [booking.id]);
  return chargePenalty(client, {
    customerId: booking.customer_id,
    amount: noShowPenalty(session.credit_cost, rules),
    sourceType: "no_show",
    bookingId: booking.id,
    note: `Tidak hadir: ${sessionLabel(session)}`,
  });
}

/* ── Check-in ────────────────────────────────────────────────────────── */

export type CheckInSource = "gate" | "pos" | "manual";

export interface GymCheckInResult {
  decision: "allowed" | "denied";
  reason: GateDenialReason | null;
  entryKind: GateEntryKind | null;
  /** Penjelasan untuk staf, mis. "Tidak ada booking kelas". */
  message: string;
  customerId: string | null;
  memberName: string | null;
  booking: { id: string; sessionId: string; className: string; startsAt: Date } | null;
  creditsDeducted: number;
  balanceAfter: number | null;
}

async function logAccess(
  client: PoolClient,
  entry: {
    customerId: string | null;
    bookingId: string | null;
    branchId: string | null;
    result: Pick<GymCheckInResult, "decision" | "reason" | "entryKind" | "creditsDeducted">;
    source: CheckInSource;
    scannedBy: string | null;
  }
) {
  await client.query(
    `INSERT INTO gym.access_logs (customer_id, booking_id, branch_id, decision, reason, entry_kind, credit_delta, source, scanned_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      entry.customerId,
      entry.bookingId,
      entry.branchId,
      entry.result.decision,
      entry.result.reason,
      entry.result.entryKind,
      -entry.result.creditsDeducted,
      entry.source,
      entry.scannedBy,
    ]
  );
}

/**
 * Gate untuk member yang QR-nya sudah sah: keanggotaan → re-entry/anti-passback
 * → booking terkonfirmasi di cabang ini sekitar sekarang → saldo. Bila lolos,
 * kredit dipotong dan booking ditandai check-in dalam transaksi yang sama.
 * Setiap hasil dicatat di gym.access_logs. `token` diisi bila gate juga harus
 * mengonsumsi QR-nya.
 */
export async function checkInBooking(
  client: PoolClient,
  input: {
    customerId: string;
    branchId?: string | null;
    scannedBy: string | null;
    token?: string;
    source?: CheckInSource;
    now?: Date;
  }
): Promise<GymCheckInResult> {
  const now = input.now ?? new Date();
  const branchId = input.branchId ?? null;
  const { rows: members } = await client.query(`SELECT name, is_active FROM pos.pos_customers WHERE id = $1`, [
    input.customerId,
  ]);
  const { rows: lastEntry } = await client.query(
    `SELECT max(created_at) AS at FROM gym.access_logs WHERE customer_id = $1 AND decision = 'allowed'`,
    [input.customerId]
  );
  const { rows: candidates } = await client.query(
    `SELECT b.id, b.session_id, s.class_type_id, s.credit_cost, s.starts_at, t.name AS class_name
       FROM gym.bookings b
       JOIN gym.class_sessions s ON s.id = b.session_id
       JOIN gym.class_types t ON t.id = s.class_type_id
      WHERE b.customer_id = $1 AND b.status = 'confirmed'
        AND s.status IN ('published', 'full')
        AND ($2::uuid IS NULL OR s.branch_id IS NULL OR s.branch_id = $2)
        AND s.starts_at <= $3::timestamptz + make_interval(mins => $4)
        AND s.ends_at >= $3::timestamptz - make_interval(mins => $5)
      ORDER BY s.starts_at
      LIMIT 1
      FOR UPDATE OF b`,
    [input.customerId, branchId, now, CHECKIN_EARLY_MIN, CHECKIN_LATE_MIN]
  );
  const rules = await getGymRules(client, branchId);
  const member = members[0];
  const candidate = candidates[0];
  // Kredit dari paket yang tidak mencakup kelas ini tidak bisa dipakai untuknya.
  const covered =
    !candidate || isClassTypeCovered(await getCoveredClassTypeIds(client, input.customerId), candidate.class_type_id);
  const balance = covered ? await getCreditBalance(client, input.customerId) : 0;

  const evaluation = evaluateGateScan({
    memberActive: Boolean(member) && member.is_active !== false,
    lastAllowedEntryAt: lastEntry[0]?.at ?? null,
    candidate: candidate ? { bookingId: candidate.id, creditCost: candidate.credit_cost } : null,
    balance,
    rules,
    now,
  });

  let decision = evaluation.decision;
  let reason = evaluation.reason;
  let creditsDeducted = 0;
  let balanceAfter: number | null = balance;

  for (const effect of evaluation.effects) {
    if (effect.kind === "consume_token" && input.token) {
      await client.query(`UPDATE crm.member_qr_tokens SET consumed_at = $2 WHERE token = $1 AND consumed_at IS NULL`, [
        input.token,
        now,
      ]);
    } else if (effect.kind === "deduct_credits") {
      const charged = await deductCredits(client, {
        customerId: input.customerId,
        amount: effect.amount,
        sourceType: "class_booking",
        sourceId: candidate.id,
        idempotencyKey: `gym:checkin:${candidate.id}`,
        note: `Check-in ${candidate.class_name}, ${formatWib(candidate.starts_at)}`,
      });
      // Saldo bisa berubah di antara baca dan potong: gate tetap tertutup.
      if (!charged.ok) {
        decision = "denied";
        reason = "insufficient_credits";
        break;
      }
      creditsDeducted = effect.amount;
      balanceAfter = charged.balanceAfter;
    } else if (effect.kind === "check_in_booking") {
      await client.query(
        `UPDATE gym.bookings SET status = 'checked_in', checked_in_at = $2, updated_at = now() WHERE id = $1`,
        [effect.bookingId, now]
      );
    }
  }

  const entryKind = decision === "allowed" ? evaluation.entryKind : null;
  const result: GymCheckInResult = {
    decision,
    reason,
    entryKind,
    message: describeGateDecision(
      { decision, reason, entryKind },
      { className: candidate?.class_name, credits: creditsDeducted, balanceAfter }
    ),
    customerId: input.customerId,
    memberName: member?.name ?? null,
    booking:
      entryKind === "booking"
        ? { id: candidate.id, sessionId: candidate.session_id, className: candidate.class_name, startsAt: candidate.starts_at }
        : null,
    creditsDeducted,
    balanceAfter,
  };
  await logAccess(client, {
    customerId: input.customerId,
    bookingId: candidate?.id ?? null,
    branchId,
    result,
    source: input.source ?? "gate",
    scannedBy: input.scannedBy,
  });
  if (entryKind === "booking") {
    await notifyMember(client, input.customerId, {
      type: "gym_checked_in",
      title: `Check-in: ${candidate.class_name}`,
      body: `${creditsDeducted} kredit dipotong. Sisa ${balanceAfter ?? 0} kredit. Selamat berlatih!`,
    });
  }
  return result;
}

/** Scan QR di gate/front desk gym: validasi token, lalu pipeline check-in. */
export async function scanGymQr(
  client: PoolClient,
  input: { token: string; branchId?: string | null; scannedBy: string | null; now?: Date }
): Promise<GymCheckInResult> {
  const now = input.now ?? new Date();
  const token = input.token.trim().toLowerCase();
  const { rows } = await client.query(
    `SELECT token, customer_id, expires_at, consumed_at FROM crm.member_qr_tokens WHERE token = $1 FOR UPDATE`,
    [token]
  );
  const row = rows[0] ?? null;
  const problem = checkQrToken(row, now);
  if (!problem) {
    return checkInBooking(client, { customerId: row.customer_id, branchId: input.branchId, scannedBy: input.scannedBy, token, now });
  }
  const reason = TOKEN_DENIAL[problem];
  const result: GymCheckInResult = {
    decision: "denied",
    reason,
    entryKind: null,
    message: GATE_DENIAL_LABEL[reason],
    customerId: row?.customer_id ?? null,
    memberName: null,
    booking: null,
    creditsDeducted: 0,
    balanceAfter: null,
  };
  await logAccess(client, {
    customerId: result.customerId,
    bookingId: null,
    branchId: input.branchId ?? null,
    result,
    source: "gate",
    scannedBy: input.scannedBy,
  });
  return result;
}

/**
 * Front desk meng-check-in booking tertentu dari daftar peserta (tanpa QR).
 * Kredit dipotong sama seperti di gate; anti-passback dan jendela waktu tidak
 * berlaku karena staf yang memutuskan.
 */
export async function checkInBookingManually(
  client: PoolClient,
  input: { bookingId: string; scannedBy: string | null; now?: Date }
): Promise<GymCheckInResult> {
  const now = input.now ?? new Date();
  const { booking, session } = await lockBookingWithSession(client, input.bookingId);
  if (!canTransitionBooking(booking.status, "checked_in")) {
    throw new SchedulingError("Hanya booking terkonfirmasi yang bisa check-in");
  }
  if (!isClassTypeCovered(await getCoveredClassTypeIds(client, booking.customer_id), session.class_type_id)) {
    throw new SchedulingError("Paket kredit member tidak mencakup kelas ini");
  }
  const charged = await deductCredits(client, {
    customerId: booking.customer_id,
    amount: session.credit_cost,
    sourceType: "class_booking",
    sourceId: booking.id,
    idempotencyKey: `gym:checkin:${booking.id}`,
    note: `Check-in ${sessionLabel(session)} (front desk)`,
  });
  if (!charged.ok) throw new SchedulingError("Kredit member tidak cukup untuk kelas ini");
  await client.query(
    `UPDATE gym.bookings SET status = 'checked_in', checked_in_at = $2, updated_at = now() WHERE id = $1`,
    [booking.id, now]
  );
  const result: GymCheckInResult = {
    decision: "allowed",
    reason: null,
    entryKind: "booking",
    message: describeGateDecision(
      { decision: "allowed", reason: null, entryKind: "booking" },
      { className: session.class_type_name, credits: session.credit_cost, balanceAfter: charged.balanceAfter }
    ),
    customerId: booking.customer_id,
    memberName: null,
    booking: { id: booking.id, sessionId: session.id, className: session.class_type_name, startsAt: session.starts_at },
    creditsDeducted: session.credit_cost,
    balanceAfter: charged.balanceAfter,
  };
  await logAccess(client, {
    customerId: booking.customer_id,
    bookingId: booking.id,
    branchId: session.branch_id,
    result,
    source: "manual",
    scannedBy: input.scannedBy,
  });
  return result;
}

/* ── Sesi: CRUD & siklus hidup ───────────────────────────────────────── */

export interface SessionInput {
  classTypeId: string;
  coachId: string | null;
  branchId: string | null;
  area: string | null;
  startsAt: Date;
  /** Kosong = ambil default jenis kelas. */
  durationMin?: number | null;
  capacity?: number | null;
  creditCost?: number | null;
  notes?: string | null;
  publish: boolean;
}

export async function createSession(client: PoolClient, input: SessionInput, createdBy: string | null): Promise<string> {
  const { rows: types } = await client.query(
    `SELECT default_duration_min, default_capacity, default_credit_cost, status FROM gym.class_types WHERE id = $1`,
    [input.classTypeId]
  );
  const type = types[0];
  if (!type || type.status !== "active") throw new SchedulingError("Jenis kelas tidak ditemukan atau diarsipkan", 404);
  const rules = await getGymRules(client, input.branchId);
  const window = deriveBookingWindow(input.startsAt, rules);
  const duration = input.durationMin || type.default_duration_min;
  const { rows } = await client.query(
    `INSERT INTO gym.class_sessions (class_type_id, coach_id, branch_id, area, starts_at, ends_at, capacity, credit_cost,
                                     booking_opens_at, booking_closes_at, status, notes, created_by)
     VALUES ($1, $2, $3, $4, $5, $5::timestamptz + make_interval(mins => $6), $7, $8, $9, $10, $11, $12, $13)
     RETURNING id`,
    [
      input.classTypeId,
      input.coachId,
      input.branchId,
      input.area,
      input.startsAt,
      duration,
      input.capacity || type.default_capacity,
      input.creditCost || type.default_credit_cost,
      window.opensAt,
      window.closesAt,
      input.publish ? "published" : "draft",
      input.notes ?? null,
      createdBy,
    ]
  );
  return rows[0].id;
}

export interface SessionPatch {
  coachId?: string | null;
  area?: string | null;
  startsAt?: Date;
  durationMin?: number;
  capacity?: number;
  notes?: string | null;
}

/**
 * Ubah sesi. Kapasitas tidak boleh di bawah member yang sudah terdaftar;
 * memindah jam mulai menurunkan ulang jendela booking dan mengabari member.
 */
export async function updateSession(client: PoolClient, id: string, patch: SessionPatch): Promise<void> {
  const session = await lockSession(client, id);
  if (session.status === "completed" || session.status === "cancelled") {
    throw new SchedulingError("Sesi yang sudah selesai atau batal tidak bisa diubah");
  }
  const held = await seatsHeld(client, id);
  if (patch.capacity !== undefined && patch.capacity < held) {
    throw new SchedulingError(`${held} member sudah terdaftar; kapasitas tidak bisa di bawah itu`);
  }
  const startsAt = patch.startsAt ?? new Date(session.starts_at);
  const durationMin =
    patch.durationMin ?? Math.round((new Date(session.ends_at).getTime() - new Date(session.starts_at).getTime()) / 60_000);
  const moved = startsAt.getTime() !== new Date(session.starts_at).getTime();
  const window = moved
    ? deriveBookingWindow(startsAt, await getGymRules(client, session.branch_id))
    : { opensAt: session.booking_opens_at, closesAt: session.booking_closes_at };
  const capacity = patch.capacity ?? session.capacity;

  await client.query(
    `UPDATE gym.class_sessions
        SET coach_id = $2, area = $3, starts_at = $4, ends_at = $4::timestamptz + make_interval(mins => $5),
            capacity = $6, notes = $7, booking_opens_at = $8, booking_closes_at = $9, updated_at = now()
      WHERE id = $1`,
    [
      id,
      patch.coachId !== undefined ? patch.coachId : session.coach_id,
      patch.area !== undefined ? patch.area : session.area,
      startsAt,
      durationMin,
      capacity,
      patch.notes !== undefined ? patch.notes : session.notes,
      window.opensAt,
      window.closesAt,
    ]
  );
  await syncSessionSeats(client, { ...session, capacity });

  if (moved) {
    const { rows } = await client.query(
      `SELECT customer_id FROM gym.bookings WHERE session_id = $1 AND status IN ('confirmed', 'waitlist')`,
      [id]
    );
    for (const row of rows) {
      await notifyMember(client, row.customer_id, {
        type: "gym_session_moved",
        title: `Jadwal berubah: ${session.class_type_name}`,
        body: `Kelas dipindah ke ${formatWib(startsAt)}. Batalkan dari portal bila tidak bisa hadir.`,
      });
    }
  }
}

export async function publishSession(client: PoolClient, id: string): Promise<void> {
  const session = await lockSession(client, id);
  if (!canTransitionSession(session.status, "published")) {
    throw new SchedulingError("Hanya sesi draf yang bisa diterbitkan");
  }
  await client.query(`UPDATE gym.class_sessions SET status = 'published', updated_at = now() WHERE id = $1`, [id]);
}

/** Batalkan sesi: semua booking aktif batal tanpa potongan, setiap member dikabari. */
export async function cancelSession(client: PoolClient, id: string): Promise<{ notified: number }> {
  const session = await lockSession(client, id);
  if (!canTransitionSession(session.status, "cancelled")) {
    throw new SchedulingError("Sesi ini sudah selesai atau sudah batal");
  }
  await client.query(`UPDATE gym.class_sessions SET status = 'cancelled', updated_at = now() WHERE id = $1`, [id]);
  const { rows } = await client.query(
    `UPDATE gym.bookings SET status = 'cancelled', waitlist_position = NULL, promotion_offered_at = NULL,
            cancelled_at = now(), updated_at = now()
      WHERE session_id = $1 AND status IN ('confirmed', 'waitlist') RETURNING customer_id`,
    [id]
  );
  for (const row of rows) {
    await notifyMember(client, row.customer_id, {
      type: "gym_session_cancelled",
      title: `Kelas dibatalkan: ${session.class_type_name}`,
      body: `Kelas ${formatWib(session.starts_at)} dibatalkan studio. Kredit Anda tidak terpotong.`,
    });
  }
  return { notified: rows.length };
}

/**
 * Tutup sesi: yang check-in → selesai, terkonfirmasi tapi tidak datang →
 * no-show (kredit hangus sesuai kebijakan), waitlist → batal.
 */
export async function completeSession(
  client: PoolClient,
  id: string
): Promise<{ completed: number; noShows: number; penaltyCredits: number }> {
  const session = await lockSession(client, id);
  if (!canTransitionSession(session.status, "completed")) {
    throw new SchedulingError("Hanya sesi terbit atau penuh yang bisa diselesaikan");
  }
  const { rows } = await client.query(
    `SELECT * FROM gym.bookings WHERE session_id = $1 AND status IN ('confirmed', 'waitlist', 'checked_in') FOR UPDATE`,
    [id]
  );
  let completed = 0;
  let noShows = 0;
  let penaltyCredits = 0;
  for (const booking of rows as BookingRow[]) {
    const next = bookingStatusOnComplete(booking.status);
    if (next === "no_show") {
      penaltyCredits += await applyNoShow(client, booking, session);
      noShows += 1;
      continue;
    }
    if (next === "completed") completed += 1;
    await client.query(
      `UPDATE gym.bookings SET status = $2, waitlist_position = NULL, updated_at = now(),
              cancelled_at = CASE WHEN $2 = 'cancelled' THEN now() ELSE cancelled_at END
        WHERE id = $1`,
      [booking.id, next]
    );
  }
  await client.query(`UPDATE gym.class_sessions SET status = 'completed', updated_at = now() WHERE id = $1`, [id]);
  return { completed, noShows, penaltyCredits };
}

/** Hapus hanya sesi tanpa booking sama sekali; selebihnya dibatalkan. */
export async function deleteSession(client: PoolClient, id: string): Promise<void> {
  await lockSession(client, id);
  const { rows } = await client.query(`SELECT 1 FROM gym.bookings WHERE session_id = $1 LIMIT 1`, [id]);
  if (rows[0]) throw new SchedulingError("Sesi ini punya booking. Batalkan sesi, jangan dihapus.");
  await client.query(`DELETE FROM gym.class_sessions WHERE id = $1`, [id]);
}

/**
 * Salin semua sesi (kecuali yang batal) dari minggu sumber ke minggu tujuan,
 * jam dan coach sama. Sesi yang sudah ada di slot tujuan dilewati.
 */
export async function duplicateWeek(
  client: PoolClient,
  input: { sourceWeekStart: string; targetWeekStart: string; publish: boolean; createdBy: string | null }
): Promise<{ created: number; skipped: number }> {
  const source = new Date(`${input.sourceWeekStart}T00:00:00+07:00`);
  const target = new Date(`${input.targetWeekStart}T00:00:00+07:00`);
  const dayShift = Math.round((target.getTime() - source.getTime()) / 86_400_000);
  if (dayShift === 0) throw new SchedulingError("Minggu tujuan harus berbeda dari minggu sumber", 400);

  const { rows } = await client.query(
    `SELECT * FROM gym.class_sessions
      WHERE starts_at >= $1 AND starts_at < $1::timestamptz + interval '7 days' AND status <> 'cancelled'
      ORDER BY starts_at`,
    [source]
  );
  const rulesByBranch = new Map<string | null, Awaited<ReturnType<typeof getGymRules>>>();
  let created = 0;
  for (const s of rows) {
    if (!rulesByBranch.has(s.branch_id)) rulesByBranch.set(s.branch_id, await getGymRules(client, s.branch_id));
    const startsAt = shiftDays(s.starts_at, dayShift);
    const window = deriveBookingWindow(startsAt, rulesByBranch.get(s.branch_id)!);
    const { rowCount } = await client.query(
      `INSERT INTO gym.class_sessions (class_type_id, coach_id, branch_id, area, starts_at, ends_at, capacity, credit_cost,
                                       booking_opens_at, booking_closes_at, status, notes, created_by)
       SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13
        WHERE NOT EXISTS (SELECT 1 FROM gym.class_sessions WHERE class_type_id = $1 AND starts_at = $5
                            AND status <> 'cancelled')`,
      [
        s.class_type_id,
        s.coach_id,
        s.branch_id,
        s.area,
        startsAt,
        shiftDays(s.ends_at, dayShift),
        s.capacity,
        s.credit_cost,
        window.opensAt,
        window.closesAt,
        input.publish ? "published" : "draft",
        s.notes,
        input.createdBy,
      ]
    );
    created += rowCount ?? 0;
  }
  return { created, skipped: rows.length - created };
}
