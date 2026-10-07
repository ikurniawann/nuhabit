import "server-only";
import { getPool, withTransaction } from "@/lib/db";
import { listSubstitutes, replaceBlockExercise, type Division, type WorkoutBlock } from "@/lib/gym/hyrox";
import type { MemberRaceStatus } from "@/lib/gym/races";
import type { RaceEventRow } from "@/lib/gym/races-server";
import { loadLibrary, type WorkoutView } from "@/lib/gym/training-server";

/* ── Workout ─────────────────────────────────────────────────────────── */

const WORKOUT_COLUMNS = "id, type, division, blocks, total_target_sec, excluded_exercise_ids, available_equipment, created_at";

export async function loadMemberWorkout(customerId: string, workoutId: string): Promise<WorkoutView | null> {
  const { rows } = await getPool().query<WorkoutView>(
    `SELECT ${WORKOUT_COLUMNS} FROM gym.workouts WHERE id = $1 AND customer_id = $2`,
    [workoutId, customerId]
  );
  return rows[0] ?? null;
}

export type ReplaceOutcome = { ok: true; workout: WorkoutView } | { ok: false; status: 404 | 409; error: string };

/**
 * Ganti latihan satu blok stasiun dengan salah satu pengganti stasiun
 * aslinya. Blok lari tidak bisa diganti.
 */
export async function replaceMemberWorkoutBlock(
  customerId: string,
  workoutId: string,
  order: number,
  exerciseId: string
): Promise<ReplaceOutcome> {
  const library = await loadLibrary();
  return withTransaction(async (client) => {
    const { rows } = await client.query<{ blocks: WorkoutBlock[] }>(
      `SELECT blocks FROM gym.workouts WHERE id = $1 AND customer_id = $2 FOR UPDATE`,
      [workoutId, customerId]
    );
    if (!rows[0]) return { ok: false, status: 404, error: "Workout tidak ditemukan" };
    const blocks = rows[0].blocks;
    const index = blocks.findIndex((b) => b.order === order);
    if (index < 0) return { ok: false, status: 404, error: "Blok tidak ditemukan" };
    const block = blocks[index]!;
    if (block.kind !== "STATION") return { ok: false, status: 409, error: "Blok lari tidak bisa diganti." };

    const substitute = listSubstitutes(block.originalExerciseId ?? block.exerciseId, library.substitutions, library.exercises).find(
      (s) => s.exercise.id === exerciseId
    );
    if (!substitute) return { ok: false, status: 409, error: "Latihan itu bukan pengganti stasiun ini." };

    const next = blocks.map((b, i) => (i === index ? replaceBlockExercise(b, substitute.exercise, substitute.rule) : b));
    const saved = await client.query<WorkoutView>(
      `UPDATE gym.workouts SET blocks = $2::jsonb WHERE id = $1 RETURNING ${WORKOUT_COLUMNS}`,
      [workoutId, JSON.stringify(next)]
    );
    return { ok: true, workout: saved.rows[0]! };
  });
}

/* ── Race ────────────────────────────────────────────────────────────── */

export type RaceEventListRow = RaceEventRow & { my_entry_id: string | null; entrant_count: number };

const RACE_EVENT_SELECT = `
  SELECT e.id, e.name, e.country, e.region, e.city, e.venue, e.starts_at, e.ends_at,
         e.registration_url, e.image_url, e.status,
         (SELECT r.id FROM gym.member_races r
           WHERE r.race_event_id = e.id AND r.customer_id = $1 AND r.status <> 'cancelled' LIMIT 1) AS my_entry_id,
         (SELECT count(*)::int FROM gym.member_races r
           WHERE r.race_event_id = e.id AND r.status <> 'cancelled') AS entrant_count
    FROM gym.race_events e`;

/** Kalender race seperti referensi: `results` = race selesai (terbaru dulu), selain itu sisanya (terdekat dulu). */
export async function listRaceEvents(
  customerId: string,
  filter: { results: boolean; region: string | null }
): Promise<RaceEventListRow[]> {
  const { rows } = await getPool().query<RaceEventListRow>(
    `${RACE_EVENT_SELECT}
      WHERE ($2::text IS NULL OR e.region = $2)
        AND ${filter.results ? "e.status = 'completed' ORDER BY e.starts_at DESC" : "e.status <> 'completed' ORDER BY e.starts_at"}`,
    [customerId, filter.region]
  );
  return rows;
}

export interface MemberRaceEntry {
  id: string;
  race_event_id: string;
  division: Division;
  goal_sec: number | null;
  result_sec: number | null;
  status: MemberRaceStatus;
}

/** Satu race + entri aktif member di race itu (bila ada). */
export async function loadRaceEvent(
  customerId: string,
  raceEventId: string
): Promise<{ event: RaceEventListRow; my_race: MemberRaceEntry | null } | null> {
  const db = getPool();
  const [event, entry] = await Promise.all([
    db.query<RaceEventListRow>(`${RACE_EVENT_SELECT} WHERE e.id = $2`, [customerId, raceEventId]),
    db.query<MemberRaceEntry>(
      `SELECT id, race_event_id, division, goal_sec, result_sec, status
         FROM gym.member_races WHERE customer_id = $1 AND race_event_id = $2 AND status <> 'cancelled' LIMIT 1`,
      [customerId, raceEventId]
    ),
  ]);
  if (!event.rows[0]) return null;
  return { event: event.rows[0], my_race: entry.rows[0] ?? null };
}

/** Jumlah simulasi penuh yang selesai (dasar prediksi race). */
export async function countFullSimulations(customerId: string): Promise<number> {
  const { rows } = await getPool().query<{ n: number }>(
    `SELECT count(*)::int AS n
       FROM gym.workout_sessions s JOIN gym.workouts w ON w.id = s.workout_id
      WHERE s.customer_id = $1 AND s.status = 'completed' AND w.type = 'FULL_SIMULATION' AND s.active_sec > 0`,
    [customerId]
  );
  return rows[0]?.n ?? 0;
}
