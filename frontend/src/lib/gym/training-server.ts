import "server-only";
import { randomInt } from "node:crypto";
import { getPool, withTransaction } from "@/lib/db";
import {
  finishSession,
  generateWorkout,
  newSession,
  pauseSession,
  recordBlock,
  resumeSession,
  sessionActiveSec,
  sessionErrorMessage,
  type Division,
  type Exercise,
  type SessionResult,
  type SubstitutionRule,
  type WorkoutBlock,
  type WorkoutBlockResult,
  type WorkoutSessionState,
  type WorkoutType,
} from "./hyrox";

/* ── Pustaka ─────────────────────────────────────────────────────────── */

interface ExerciseRow {
  id: string;
  name: string;
  category: Exercise["category"];
  equipment: string[];
  hyrox_station_order: number | null;
  difficulty: number;
  default_spec: { distanceM?: number | null; reps?: number | null } | null;
  video_url: string | null;
}

function toExercise(row: ExerciseRow): Exercise {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    equipment: row.equipment ?? [],
    hyroxStationOrder: row.hyrox_station_order,
    difficulty: Math.min(3, Math.max(1, row.difficulty)) as Exercise["difficulty"],
    defaultSpec: { distanceM: row.default_spec?.distanceM ?? null, reps: row.default_spec?.reps ?? null },
    videoUrl: row.video_url,
  };
}

/** Latihan aktif + aturan substitusi di antara latihan aktif. */
export async function loadLibrary(): Promise<{ exercises: Exercise[]; substitutions: SubstitutionRule[] }> {
  const db = getPool();
  const [exercises, substitutions] = await Promise.all([
    db.query<ExerciseRow>(
      `SELECT id, name, category, equipment, hyrox_station_order, difficulty, default_spec, video_url
         FROM gym.exercises WHERE is_active ORDER BY hyrox_station_order NULLS LAST, name`
    ),
    db.query<SubstitutionRule>(
      `SELECT s.original_exercise_id AS "originalExerciseId", s.alternative_exercise_id AS "alternativeExerciseId",
              s.similarity::float AS similarity, s.volume_factor::float AS "volumeFactor",
              s.conversion_note AS "conversionNote"
         FROM gym.substitution_rules s
         JOIN gym.exercises o ON o.id = s.original_exercise_id AND o.is_active
         JOIN gym.exercises a ON a.id = s.alternative_exercise_id AND a.is_active`
    ),
  ]);
  return { exercises: exercises.rows.map(toExercise), substitutions: substitutions.rows };
}

/* ── Workout ─────────────────────────────────────────────────────────── */

export interface WorkoutView {
  id: string;
  type: WorkoutType;
  division: Division;
  blocks: WorkoutBlock[];
  total_target_sec: number;
  excluded_exercise_ids: string[];
  available_equipment: string[] | null;
  created_at: string;
}

export interface GenerateInput {
  type: WorkoutType;
  division: Division;
  stationOrders: number[];
  excludedExerciseIds: string[];
  availableEquipment: string[] | null;
}

export type GenerateOutcome =
  | { ok: true; workout: WorkoutView; unresolvedExerciseIds: string[] }
  | { ok: false; error: string };

/** Buat dan simpan workout untuk member dari pustaka aktif. */
export async function generateMemberWorkout(customerId: string, input: GenerateInput): Promise<GenerateOutcome> {
  const { exercises, substitutions } = await loadLibrary();
  const result = generateWorkout({ ...input, exercises, substitutions, pick: (n) => (n > 1 ? randomInt(n) : 0) });
  if (result.blocks.length === 0) return { ok: false, error: "Belum ada stasiun untuk menyusun workout." };
  const { rows } = await getPool().query<WorkoutView>(
    `INSERT INTO gym.workouts (customer_id, type, division, blocks, excluded_exercise_ids, available_equipment, total_target_sec)
     VALUES ($1, $2, $3, $4::jsonb, $5::uuid[], $6::text[], $7)
     RETURNING id, type, division, blocks, total_target_sec, excluded_exercise_ids, available_equipment, created_at`,
    [
      customerId,
      input.type,
      input.division,
      JSON.stringify(result.blocks),
      result.excludedExerciseIds,
      input.availableEquipment,
      result.totalTargetSec,
    ]
  );
  return { ok: true, workout: rows[0]!, unresolvedExerciseIds: result.unresolvedExerciseIds };
}

/* ── Sesi workout ────────────────────────────────────────────────────── */

export interface WorkoutSessionView {
  id: string;
  workout_id: string;
  status: WorkoutSessionState["status"];
  current_block: number;
  started_at: string | null;
  ended_at: string | null;
  paused_at: string | null;
  block_results: WorkoutBlockResult[];
  pause_count: number;
  total_pause_sec: number;
  active_sec: number;
  created_at: string;
}

const SESSION_FIELDS = [
  "id", "workout_id", "status", "current_block", "started_at", "ended_at", "paused_at", "block_results",
  "pause_count", "total_pause_sec", "active_sec", "created_at",
];
const sessionColumns = (alias = "") => SESSION_FIELDS.map((field) => alias + field).join(", ");
const SESSION_COLUMNS = sessionColumns();

const iso = (value: string | Date | null) => (value === null ? null : new Date(value).toISOString());

function toState(row: WorkoutSessionView): WorkoutSessionState {
  return {
    status: row.status,
    currentBlock: row.current_block,
    startedAt: iso(row.started_at),
    endedAt: iso(row.ended_at),
    pausedAt: iso(row.paused_at),
    blockResults: row.block_results ?? [],
    pauseCount: row.pause_count,
    totalPauseSec: row.total_pause_sec,
  };
}

/** Mulai sesi baru. Mengulang workout yang sama = sesi baru, hasil baru. */
export async function startWorkoutSession(customerId: string, workoutId: string): Promise<WorkoutSessionView | null> {
  const state = newSession(new Date());
  const { rows } = await getPool().query<WorkoutSessionView>(
    `INSERT INTO gym.workout_sessions (workout_id, customer_id, status, current_block, started_at)
     SELECT w.id, w.customer_id, $3, $4, $5 FROM gym.workouts w WHERE w.id = $1 AND w.customer_id = $2
     RETURNING ${SESSION_COLUMNS}`,
    [workoutId, customerId, state.status, state.currentBlock, state.startedAt]
  );
  return rows[0] ?? null;
}

export type SessionAction =
  | { action: "pause" }
  | { action: "resume" }
  | { action: "record"; order: number; durationSec: number }
  | { action: "complete"; blockResults?: WorkoutBlockResult[]; partial?: boolean };

export type SessionOutcome =
  | { ok: true; session: WorkoutSessionView }
  | { ok: false; status: 404 | 409; error: string };

/** Jalankan satu aksi pada sesi milik member, dikunci per baris. */
export async function actOnWorkoutSession(
  customerId: string,
  sessionId: string,
  input: SessionAction
): Promise<SessionOutcome> {
  return withTransaction(async (client) => {
    const { rows } = await client.query<WorkoutSessionView & { total_blocks: number }>(
      `SELECT ${sessionColumns("s.")},
              jsonb_array_length(w.blocks)::int AS total_blocks
         FROM gym.workout_sessions s JOIN gym.workouts w ON w.id = s.workout_id
        WHERE s.id = $1 AND s.customer_id = $2
        FOR UPDATE OF s`,
      [sessionId, customerId]
    );
    const row = rows[0];
    if (!row) return { ok: false, status: 404, error: "Sesi tidak ditemukan" };

    const now = new Date();
    const state = toState(row);
    let result: SessionResult;
    switch (input.action) {
      case "pause":
        result = pauseSession(state, now);
        break;
      case "resume":
        result = resumeSession(state, now);
        break;
      case "record":
        result = recordBlock(state, row.total_blocks, { order: input.order, durationSec: input.durationSec });
        break;
      case "complete":
        result = finishSession(state, row.total_blocks, input, now);
        break;
    }
    if (!result.ok) return { ok: false, status: 409, error: sessionErrorMessage(result.error) };

    const next = result.session;
    const saved = await client.query<WorkoutSessionView>(
      `UPDATE gym.workout_sessions
          SET status = $2, current_block = $3, ended_at = $4, paused_at = $5, block_results = $6::jsonb,
              pause_count = $7, total_pause_sec = $8, active_sec = $9, updated_at = now()
        WHERE id = $1
        RETURNING ${SESSION_COLUMNS}`,
      [
        sessionId,
        next.status,
        next.currentBlock,
        next.endedAt,
        next.pausedAt,
        JSON.stringify(next.blockResults),
        next.pauseCount,
        next.totalPauseSec,
        sessionActiveSec(next),
      ]
    );
    return { ok: true, session: saved.rows[0]! };
  });
}

export async function loadMemberSession(customerId: string, sessionId: string): Promise<WorkoutSessionView | null> {
  const { rows } = await getPool().query<WorkoutSessionView>(
    `SELECT ${SESSION_COLUMNS} FROM gym.workout_sessions WHERE id = $1 AND customer_id = $2`,
    [sessionId, customerId]
  );
  return rows[0] ?? null;
}

/* ── Riwayat ─────────────────────────────────────────────────────────── */

export interface WorkoutHistoryItem extends WorkoutView {
  sessions: WorkoutSessionView[];
}

/** 20 workout terakhir member beserta sesi-sesinya (terbaru dulu). */
export async function memberWorkoutHistory(customerId: string): Promise<WorkoutHistoryItem[]> {
  const { rows } = await getPool().query<WorkoutHistoryItem>(
    `SELECT w.id, w.type, w.division, w.blocks, w.total_target_sec, w.excluded_exercise_ids,
            w.available_equipment, w.created_at,
            COALESCE((
              SELECT jsonb_agg(to_jsonb(s) - 'customer_id' - 'updated_at' ORDER BY s.created_at DESC)
                FROM gym.workout_sessions s WHERE s.workout_id = w.id
            ), '[]'::jsonb) AS sessions
       FROM gym.workouts w
      WHERE w.customer_id = $1
      ORDER BY w.created_at DESC
      LIMIT 20`,
    [customerId]
  );
  return rows;
}
