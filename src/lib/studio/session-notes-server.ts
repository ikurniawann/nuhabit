import { ApiError } from "@/lib/api/auth";
import { query, queryOne } from "@/lib/db";
import { VENUE_TODAY_SQL } from "@/lib/studio/pass-server";
import { canWriteNote, NOTE_HISTORY_DAYS, notesForRoster, type SessionNote } from "@/lib/studio/session-notes";

/**
 * Catatan coach setelah sesi (EPIC-067 T-067-C4) — hanya jalur Coach Portal.
 * Catatan yang dibawa ke sesi berikutnya terlihat oleh semua coach yang
 * mengajar member itu (lewat roster sesinya), tidak pernah lewat backoffice.
 */

const NOTE_SELECT = `
  SELECT n.id, n.customer_id, n.body, n.carry_forward,
         (n.carry_forward AND n.released_at IS NULL) AS pinned,
         n.coach_id, COALESCE(c.display_name, c.full_name) AS coach_name,
         CASE WHEN s.id IS NULL THEN NULL ELSE p.name END AS session_label,
         s.session_date::text AS session_date, n.created_at
  FROM studio.member_session_notes n
  JOIN studio.coaches c ON c.id = n.coach_id
  LEFT JOIN studio.class_sessions s ON s.id = n.session_id
  LEFT JOIN studio.programs p ON p.id = s.program_id`;

/** Catatan untuk roster: yang dibawa (berapa pun umurnya) + riwayat 60 hari, per member. */
export async function notesForCustomers(branchId: string, customerIds: string[]): Promise<Map<string, SessionNote[]>> {
  const out = new Map<string, SessionNote[]>();
  if (customerIds.length === 0) return out;
  const rows = await query<SessionNote>(
    `${NOTE_SELECT}
     WHERE n.branch_id = $1 AND n.customer_id = ANY($2::uuid[]) AND n.removed_at IS NULL
       AND ((n.carry_forward AND n.released_at IS NULL) OR n.created_at >= now() - ($3::int * interval '1 day'))`,
    [branchId, customerIds, NOTE_HISTORY_DAYS]
  );
  for (const id of customerIds) out.set(id, notesForRoster(rows.filter((r) => r.customer_id === id)));
  return out;
}

export async function createSessionNote(
  coach: { id: string; company_id: string; branch_id: string },
  userId: string,
  sessionId: string,
  input: { customer_id: string; body: string; carry_forward: boolean }
): Promise<string> {
  const s = await queryOne<{ session_date: string; today: string }>(
    `SELECT session_date::text AS session_date, ${VENUE_TODAY_SQL}::text AS today FROM studio.class_sessions
     WHERE id = $1 AND coach_id = $2 AND status <> 'cancelled'`,
    [sessionId, coach.id]
  );
  if (!s) throw ApiError.notFound("Sesi tidak ditemukan");
  if (!canWriteNote(s.session_date, s.today)) {
    throw ApiError.conflict("Catatan sesi ditulis setelah sesi berjalan — hari itu atau paling lama 7 hari sesudahnya");
  }
  const inSession = await queryOne(
    `SELECT 1 FROM studio.bookings WHERE session_id = $1 AND customer_id = $2 AND status IN ('booked','attended','no_show')`,
    [sessionId, input.customer_id]
  );
  if (!inSession) throw ApiError.badRequest("Member ini tidak ada di sesi tersebut");
  const row = await queryOne<{ id: string }>(
    `INSERT INTO studio.member_session_notes (company_id, branch_id, customer_id, session_id, coach_id, body, carry_forward, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [coach.company_id, coach.branch_id, input.customer_id, sessionId, coach.id, input.body.trim(), input.carry_forward, userId]
  );
  return row!.id;
}

async function loadNote(branchId: string, id: string) {
  const n = await queryOne<{ id: string; customer_id: string; coach_id: string; carry_forward: boolean; released_at: string | null }>(
    `SELECT id, customer_id, coach_id, carry_forward, released_at FROM studio.member_session_notes
     WHERE id = $1 AND branch_id = $2 AND removed_at IS NULL`,
    [id, branchId]
  );
  if (!n) throw ApiError.notFound("Catatan tidak ditemukan");
  return n;
}

/**
 * Lepas catatan dari "bawa ke sesi berikutnya" (mis. cedera sudah pulih) —
 * boleh oleh coach mana pun yang sedang/akan/baru mengajar member itu.
 */
export async function releaseSessionNote(coach: { id: string; branch_id: string }, id: string): Promise<void> {
  const n = await loadNote(coach.branch_id, id);
  if (n.coach_id !== coach.id) {
    const teaches = await queryOne(
      `SELECT 1 FROM studio.bookings b JOIN studio.class_sessions s ON s.id = b.session_id
       WHERE b.customer_id = $2 AND s.coach_id = $1 AND s.status <> 'cancelled'
         AND s.session_date >= ${VENUE_TODAY_SQL} - 30 AND b.status IN ('booked','waitlisted','attended','no_show')
       LIMIT 1`,
      [coach.id, n.customer_id]
    );
    if (!teaches) throw ApiError.notFound("Catatan tidak ditemukan");
  }
  if (!n.carry_forward || n.released_at) return;
  await query(
    `UPDATE studio.member_session_notes SET released_at = now(), released_by_coach_id = $2, updated_at = now() WHERE id = $1`,
    [id, coach.id]
  );
}

/** Hapus catatan — hanya penulisnya. */
export async function deleteSessionNote(coach: { id: string; branch_id: string }, id: string): Promise<void> {
  const n = await loadNote(coach.branch_id, id);
  if (n.coach_id !== coach.id) throw ApiError.forbidden("Hanya penulis catatan yang bisa menghapusnya");
  await query(`UPDATE studio.member_session_notes SET removed_at = now(), updated_at = now() WHERE id = $1`, [id]);
}
