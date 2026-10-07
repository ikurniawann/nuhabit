import "server-only";
/**
 * Bagian bersama jadwal & booking: galat bisnis, bentuk baris, kunci
 * sesi/booking, sinkron kursi, dan potongan kredit hukuman.
 */
import type { Pool, PoolClient } from "pg";
import { ApiError } from "@/lib/api/auth";
import { formatWib } from "@/lib/crm/engagement/rules";
import { deductCredits, getCreditBalance } from "@/lib/gym/credits-server";
import { getGymRules, type GymRules } from "@/lib/gym/rules";
import { noShowPenalty, sessionStatusForSeats, type BookingStatus, type SessionStatus } from "./booking";

export type Db = Pool | PoolClient;

/** Galat bisnis yang aman ditampilkan ke pengguna (route → 4xx lewat apiHandler). */
export class SchedulingError extends ApiError {
  constructor(
    message: string,
    status = 409,
    readonly code?: string
  ) {
    super(status, message);
    this.name = "SchedulingError";
  }
}

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

export interface BookingRow {
  id: string;
  session_id: string;
  customer_id: string;
  status: BookingStatus;
  waitlist_position: number | null;
  promotion_offered_at: Date | null;
  created_at: Date;
}

export const SESSION_SELECT = `
  SELECT s.id, s.class_type_id, t.name AS class_type_name, t.color, s.coach_id, c.name AS coach_name,
         s.branch_id, s.area, s.starts_at, s.ends_at, s.capacity, s.credit_cost,
         s.booking_opens_at, s.booking_closes_at, s.status, s.notes
    FROM gym.class_sessions s
    JOIN gym.class_types t ON t.id = s.class_type_id
    LEFT JOIN gym.coaches c ON c.id = s.coach_id`;

/** Kursi terpakai = confirmed + sudah check-in. */
export const SEATS_HELD = `status IN ('confirmed', 'checked_in', 'completed')`;

export const sessionLabel = (s: Pick<SessionRow, "class_type_name" | "starts_at">) =>
  `${s.class_type_name}, ${formatWib(s.starts_at)}`;

/** Aturan gym per cabang, dibaca sekali per cabang selama satu operasi. */
export function branchRules(db: Db): (branchId: string | null) => Promise<GymRules> {
  const cache = new Map<string | null, Promise<GymRules>>();
  return (branchId) => {
    let rules = cache.get(branchId);
    if (!rules) {
      rules = getGymRules(db, branchId);
      cache.set(branchId, rules);
    }
    return rules;
  };
}

export async function lockSession(client: PoolClient, id: string): Promise<SessionRow> {
  const { rows } = await client.query(`${SESSION_SELECT} WHERE s.id = $1 FOR UPDATE OF s`, [id]);
  if (!rows[0]) throw new SchedulingError("Sesi tidak ditemukan", 404);
  return rows[0] as SessionRow;
}

/**
 * Kunci sesi lalu booking-nya, selalu dalam urutan ini (sama dengan
 * bookSession dan completeSession) supaya dua transaksi tidak saling tunggu.
 */
export async function lockBookingWithSession(
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

export async function seatsHeld(client: PoolClient, sessionId: string): Promise<number> {
  const { rows } = await client.query(
    `SELECT count(*)::int AS n FROM gym.bookings WHERE session_id = $1 AND ${SEATS_HELD}`,
    [sessionId]
  );
  return rows[0].n;
}

/** Selaraskan published ↔ full dengan kursi yang terisi sekarang. */
export async function syncSessionSeats(client: PoolClient, session: SessionRow): Promise<void> {
  const next = sessionStatusForSeats(session.status, await seatsHeld(client, session.id), session.capacity);
  if (next === session.status) return;
  await client.query(`UPDATE gym.class_sessions SET status = $2, updated_at = now() WHERE id = $1`, [session.id, next]);
  session.status = next;
}

/**
 * Potong kredit hukuman (batal terlambat / no-show). Saldo yang kurang tidak
 * membuat saldo negatif: yang dipotong sebanyak saldo yang ada.
 */
export async function chargePenalty(
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

/** Tandai no-show dan potong kredit sesuai kebijakan; kembalikan kredit yang dipotong. */
export async function applyNoShow(client: PoolClient, booking: BookingRow, session: SessionRow): Promise<number> {
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
