import { ApiError } from "@/lib/api/auth";
import { query, queryOne } from "@/lib/db";
import { findCoachConflicts, WEEKDAY_LABELS } from "@/lib/studio/schedule";

/** Tolak slot template yang membuat coach mengajar dua kelas sekaligus di hari yang sama. */
export async function assertTemplateCoachFree(
  branchId: string,
  slot: { id?: string; weekday: number; start_time: string; end_time: string; coach_id?: string | null }
) {
  if (!slot.coach_id) return;
  const others = await query<{ id: string; coach_id: string; weekday: number; start_time: string; end_time: string }>(
    `SELECT id, coach_id, weekday, to_char(start_time,'HH24:MI') AS start_time, to_char(end_time,'HH24:MI') AS end_time
     FROM studio.schedule_templates
     WHERE branch_id = $1 AND coach_id = $2 AND weekday = $3 AND is_active`,
    [branchId, slot.coach_id, slot.weekday]
  );
  const hits = findCoachConflicts({ ...slot, coach_id: slot.coach_id }, others);
  if (hits.length > 0) {
    throw ApiError.conflict(`Coach sudah mengajar ${WEEKDAY_LABELS[slot.weekday - 1]} ${hits[0].start_time}–${hits[0].end_time}`);
  }
}

/** Tolak sesi yang membuat coach bentrok dengan sesi aktif lain di tanggal yang sama. */
export async function assertSessionCoachFree(
  branchId: string,
  slot: { id?: string; session_date: string; start_time: string; end_time: string; coach_id?: string | null }
) {
  if (!slot.coach_id) return;
  const others = await query<{ id: string; coach_id: string; session_date: string; start_time: string; end_time: string }>(
    `SELECT id, coach_id, session_date::text AS session_date,
            to_char(start_time,'HH24:MI') AS start_time, to_char(end_time,'HH24:MI') AS end_time
     FROM studio.class_sessions
     WHERE branch_id = $1 AND coach_id = $2 AND session_date = $3::date AND status <> 'cancelled'`,
    [branchId, slot.coach_id, slot.session_date]
  );
  const hits = findCoachConflicts({ ...slot, coach_id: slot.coach_id }, others);
  if (hits.length > 0) {
    throw ApiError.conflict(`Coach sudah mengajar di ${hits[0].start_time}–${hits[0].end_time} pada tanggal itu`);
  }
}

/** Tolak menjadwalkan coach di tanggal ia cuti / time-off (EPIC-067 T-067-A5). */
export async function assertCoachNotOnTimeOff(branchId: string, coachId: string | null | undefined, date: string) {
  if (!coachId) return;
  const off = await queryOne<{ date_from: string; date_to: string; reason: string | null }>(
    `SELECT date_from::text AS date_from, date_to::text AS date_to, reason FROM studio.coach_time_off
     WHERE branch_id = $1 AND coach_id = $2 AND $3::date BETWEEN date_from AND date_to
     ORDER BY date_from LIMIT 1`,
    [branchId, coachId, date]
  );
  if (off) {
    throw ApiError.conflict(
      `Coach sedang cuti / tidak tersedia ${off.date_from === off.date_to ? off.date_from : `${off.date_from} s.d. ${off.date_to}`}${off.reason ? ` (${off.reason})` : ""} — pilih coach lain`
    );
  }
}
