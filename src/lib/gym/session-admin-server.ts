import "server-only";
/** Sesi kelas untuk admin: buat, ubah, terbitkan, batalkan, selesaikan, hapus, salin minggu. */
import type { PoolClient } from "pg";
import { notifyMember } from "@/lib/crm/engagement/server";
import { formatWib } from "@/lib/crm/engagement/rules";
import { getGymRules } from "@/lib/gym/rules";
import { bookingStatusOnComplete, canTransitionSession, deriveBookingWindow, shiftDays } from "./booking";
import {
  applyNoShow,
  branchRules,
  lockSession,
  SchedulingError,
  seatsHeld,
  syncSessionSeats,
  type BookingRow,
} from "./booking-store";

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
  const rulesFor = branchRules(client);
  let created = 0;
  for (const s of rows) {
    const startsAt = shiftDays(s.starts_at, dayShift);
    const window = deriveBookingWindow(startsAt, await rulesFor(s.branch_id));
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
