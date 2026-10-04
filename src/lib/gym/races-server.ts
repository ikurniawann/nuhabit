import "server-only";
import { getPool, withTransaction } from "@/lib/db";
import type { Division } from "./hyrox";
import {
  analyzeRace,
  canTargetRace,
  daysUntil,
  planMemberRaceUpdate,
  predictRaceSec,
  raceReadinessScore,
  READINESS_WINDOW_DAYS,
  type MemberRaceStatus,
  type MemberRaceUpdate,
  type RaceAnalysis,
  type RaceStatus,
} from "./races";

export interface RaceEventRow {
  id: string;
  name: string;
  country: string;
  region: string;
  city: string;
  venue: string;
  starts_at: string;
  ends_at: string;
  registration_url: string;
  image_url: string | null;
  status: RaceStatus;
}

export interface MemberRaceView {
  id: string;
  race_event_id: string;
  division: Division;
  goal_sec: number | null;
  result_sec: number | null;
  status: MemberRaceStatus;
  created_at: string;
  event: RaceEventRow;
  days_until: number;
  /** Prediksi dari simulasi penuh sebelum race dimulai. */
  prediction_sec: number | null;
  analysis: RaceAnalysis | null;
}

export interface MemberRaceOverview {
  /** Prediksi saat ini dari simulasi penuh terbaik. */
  prediction_sec: number | null;
  best_simulation_sec: number | null;
  readiness: number;
  activities_last_28d: number;
  my_races: MemberRaceView[];
  events: (RaceEventRow & { my_entry_id: string | null; entrant_count: number })[];
}

/**
 * Ringkasan race member: kalender race mendatang, race yang ditargetkan,
 * prediksi waktu, kesiapan 28 hari, dan analisis hasil.
 */
export async function memberRaceOverview(customerId: string, now = new Date()): Promise<MemberRaceOverview> {
  const db = getPool();
  const [sims, activities, entries, events] = await Promise.all([
    // Simulasi penuh yang selesai: dasar prediksi.
    db.query<{ active_sec: number; ended_at: Date }>(
      `SELECT s.active_sec, s.ended_at
         FROM gym.workout_sessions s JOIN gym.workouts w ON w.id = s.workout_id
        WHERE s.customer_id = $1 AND s.status = 'completed' AND w.type = 'FULL_SIMULATION' AND s.active_sec > 0`,
      [customerId]
    ),
    // Aktivitas: workout yang selesai/parsial + kelas yang dihadiri.
    db.query<{ at: Date }>(
      `SELECT ended_at AS at FROM gym.workout_sessions
        WHERE customer_id = $1 AND status IN ('completed', 'partial') AND ended_at >= $2
       UNION ALL
       SELECT cs.starts_at FROM gym.bookings b JOIN gym.class_sessions cs ON cs.id = b.session_id
        WHERE b.customer_id = $1 AND b.status IN ('checked_in', 'completed') AND cs.starts_at >= $2`,
      [customerId, new Date(now.getTime() - READINESS_WINDOW_DAYS * 86_400_000)]
    ),
    db.query<Omit<MemberRaceView, "days_until" | "prediction_sec" | "analysis">>(
      `SELECT r.id, r.race_event_id, r.division, r.goal_sec, r.result_sec, r.status, r.created_at,
              to_jsonb(e) - 'created_at' - 'updated_at' AS event
         FROM gym.member_races r JOIN gym.race_events e ON e.id = r.race_event_id
        WHERE r.customer_id = $1
        ORDER BY (r.status = 'cancelled'), e.starts_at`,
      [customerId]
    ),
    db.query<RaceEventRow & { my_entry_id: string | null; entrant_count: number }>(
      `SELECT e.*,
              (SELECT r.id FROM gym.member_races r
                WHERE r.race_event_id = e.id AND r.customer_id = $1 AND r.status <> 'cancelled' LIMIT 1) AS my_entry_id,
              (SELECT count(*)::int FROM gym.member_races r
                WHERE r.race_event_id = e.id AND r.status <> 'cancelled') AS entrant_count
         FROM gym.race_events e
        WHERE e.status NOT IN ('completed', 'cancelled') AND e.ends_at >= $2
        ORDER BY e.starts_at`,
      [customerId, now]
    ),
  ]);

  const simSecs = sims.rows.map((s) => s.active_sec);
  const predictionBefore = (startsAt: string) =>
    predictRaceSec(sims.rows.filter((s) => new Date(s.ended_at) < new Date(startsAt)).map((s) => s.active_sec));

  return {
    prediction_sec: predictRaceSec(simSecs),
    best_simulation_sec: simSecs.length ? Math.min(...simSecs) : null,
    readiness: raceReadinessScore(activities.rows.map((a) => a.at), now),
    activities_last_28d: activities.rows.length,
    my_races: entries.rows.map((entry) => {
      const prediction = predictionBefore(entry.event.starts_at);
      return {
        ...entry,
        days_until: daysUntil(entry.event.starts_at, now),
        prediction_sec: prediction,
        analysis: entry.result_sec !== null ? analyzeRace(entry.result_sec, entry.goal_sec, prediction) : null,
      };
    }),
    events: events.rows,
  };
}

/* ── Mutasi race member ──────────────────────────────────────────────── */

export type RaceEntryOutcome = { ok: true; id: string } | { ok: false; status: 404 | 409; error: string };

/**
 * Daftarkan target race. Entri yang pernah dibatalkan dihidupkan lagi, bukan
 * diduplikasi: index unik hanya menjaga entri hidup.
 */
export async function registerForRace(
  customerId: string,
  input: { raceEventId: string; division: Division; goalSec: number | null }
): Promise<RaceEntryOutcome> {
  return withTransaction(async (client) => {
    const event = await client.query<{ status: RaceStatus }>(`SELECT status FROM gym.race_events WHERE id = $1`, [
      input.raceEventId,
    ]);
    if (!event.rows[0]) return { ok: false, status: 404, error: "Race tidak ditemukan" };
    if (!canTargetRace(event.rows[0].status)) return { ok: false, status: 409, error: "Race ini sudah selesai atau dibatalkan" };

    const existing = await client.query<{ id: string; status: MemberRaceStatus }>(
      `SELECT id, status FROM gym.member_races WHERE customer_id = $1 AND race_event_id = $2
        ORDER BY (status = 'cancelled'), created_at DESC LIMIT 1 FOR UPDATE`,
      [customerId, input.raceEventId]
    );
    const entry = existing.rows[0];
    if (entry && entry.status !== "cancelled") return { ok: false, status: 409, error: "Kamu sudah menargetkan race ini" };
    const { rows } = entry
      ? await client.query<{ id: string }>(
          `UPDATE gym.member_races SET status = 'training', division = $2, goal_sec = $3, result_sec = NULL, updated_at = now()
            WHERE id = $1 RETURNING id`,
          [entry.id, input.division, input.goalSec]
        )
      : await client.query<{ id: string }>(
          `INSERT INTO gym.member_races (customer_id, race_event_id, division, goal_sec) VALUES ($1, $2, $3, $4) RETURNING id`,
          [customerId, input.raceEventId, input.division, input.goalSec]
        );
    return { ok: true, id: rows[0]!.id };
  });
}

/** Ubah target/divisi, catat hasil (→ raced), atau batalkan race milik member. */
export async function updateMemberRace(
  customerId: string,
  entryId: string,
  update: MemberRaceUpdate
): Promise<RaceEntryOutcome> {
  return withTransaction(async (client) => {
    const { rows } = await client.query<{ status: MemberRaceStatus }>(
      `SELECT status FROM gym.member_races WHERE id = $1 AND customer_id = $2 FOR UPDATE`,
      [entryId, customerId]
    );
    if (!rows[0]) return { ok: false, status: 404, error: "Race tidak ditemukan" };
    const plan = planMemberRaceUpdate(rows[0].status, update);
    if (!plan.ok) return { ok: false, status: 409, error: plan.error };
    await client.query(
      `UPDATE gym.member_races SET status = $2,
              division = COALESCE($3, division),
              goal_sec = CASE WHEN $4::boolean THEN $5::int ELSE goal_sec END,
              result_sec = COALESCE($6::int, result_sec),
              updated_at = now()
        WHERE id = $1`,
      [entryId, plan.status, plan.division ?? null, plan.goalSec !== undefined, plan.goalSec ?? null, plan.resultSec ?? null]
    );
    return { ok: true, id: entryId };
  });
}
