import "server-only";
/** Pustaka latihan & aturan substitusi untuk admin. */
import { z } from "zod";
import { ApiError } from "@/lib/api/auth";
import { getPool } from "@/lib/db";
import { EXERCISE_CATEGORIES } from "./hyrox";
import { isUniqueViolation } from "./staff-route";

export const exerciseSchema = z.object({
  id: z.string().uuid().optional(),
  code: z
    .string()
    .trim()
    .regex(/^[a-z0-9_]{2,40}$/, "Kode: huruf kecil, angka, garis bawah"),
  name: z.string().trim().min(2).max(80),
  description: z.string().max(1_000).default(""),
  category: z.enum(EXERCISE_CATEGORIES),
  equipment: z.array(z.string().trim().regex(/^[a-z0-9_]{2,30}$/)).max(10).default([]),
  hyrox_station_order: z.number().int().min(1).max(8).nullable().default(null),
  difficulty: z.number().int().min(1).max(3),
  default_spec: z.object({
    distanceM: z.number().int().positive().max(42_195).nullable(),
    reps: z.number().int().positive().max(1_000).nullable(),
  }),
  video_url: z.string().trim().url().max(500).nullable().default(null),
  is_active: z.boolean().default(true),
});

export const substitutionSchema = z
  .object({
    original_exercise_id: z.string().uuid(),
    alternative_exercise_id: z.string().uuid(),
    similarity: z.number().min(0).max(1),
    volume_factor: z.number().positive().max(10).default(1),
    conversion_note: z.string().trim().max(300).default(""),
  })
  .refine((r) => r.original_exercise_id !== r.alternative_exercise_id, {
    message: "Latihan pengganti harus berbeda",
    path: ["alternative_exercise_id"],
  });

export type ExerciseInput = z.infer<typeof exerciseSchema>;
export type SubstitutionInput = z.infer<typeof substitutionSchema>;

/** Pustaka latihan + aturan substitusi (dengan nama latihan). */
export async function loadExerciseAdmin() {
  const db = getPool();
  const [exercises, substitutions] = await Promise.all([
    db.query(
      `SELECT id, code, name, description, category, equipment, hyrox_station_order, difficulty, default_spec,
              video_url, is_active, updated_at
         FROM gym.exercises ORDER BY hyrox_station_order NULLS LAST, name`
    ),
    db.query(
      `SELECT s.id, s.original_exercise_id, o.name AS original_name, s.alternative_exercise_id, a.name AS alternative_name,
              s.similarity::float AS similarity, s.volume_factor::float AS volume_factor, s.conversion_note
         FROM gym.substitution_rules s
         JOIN gym.exercises o ON o.id = s.original_exercise_id
         JOIN gym.exercises a ON a.id = s.alternative_exercise_id
        ORDER BY o.hyrox_station_order NULLS LAST, o.name, s.similarity DESC`
    ),
  ]);
  return { exercises: exercises.rows, substitutions: substitutions.rows };
}

/** Buat atau ubah latihan. Nomor stasiun dan kode harus unik. */
export async function saveExercise(e: ExerciseInput): Promise<{ id: string }> {
  const params = [
    e.code,
    e.name,
    e.description,
    e.category,
    e.equipment,
    e.hyrox_station_order,
    e.difficulty,
    JSON.stringify(e.default_spec),
    e.video_url,
    e.is_active,
  ];
  try {
    const { rows } = e.id
      ? await getPool().query<{ id: string }>(
          `UPDATE gym.exercises SET code=$1, name=$2, description=$3, category=$4, equipment=$5::text[],
                  hyrox_station_order=$6, difficulty=$7, default_spec=$8::jsonb, video_url=$9, is_active=$10,
                  updated_at=now()
            WHERE id=$11 RETURNING id`,
          [...params, e.id]
        )
      : await getPool().query<{ id: string }>(
          `INSERT INTO gym.exercises (code, name, description, category, equipment, hyrox_station_order, difficulty,
                                      default_spec, video_url, is_active)
           VALUES ($1,$2,$3,$4,$5::text[],$6,$7,$8::jsonb,$9,$10) RETURNING id`,
          params
        );
    if (!rows[0]) throw ApiError.notFound("Latihan tidak ditemukan");
    return rows[0];
  } catch (error) {
    if (isUniqueViolation(error)) throw ApiError.conflict("Kode atau nomor stasiun sudah dipakai latihan lain");
    throw error;
  }
}

/** Hapus latihan beserta aturan substitusinya. Workout lama utuh karena bloknya menyimpan nama latihan. */
export async function deleteExercise(id: string): Promise<void> {
  const { rowCount } = await getPool().query(`DELETE FROM gym.exercises WHERE id = $1`, [id]);
  if (!rowCount) throw ApiError.notFound("Latihan tidak ditemukan");
}

/** Buat atau perbarui aturan substitusi untuk pasangan latihan. */
export async function saveSubstitution(r: SubstitutionInput): Promise<{ id: string }> {
  const { rows } = await getPool().query<{ id: string }>(
    `INSERT INTO gym.substitution_rules (original_exercise_id, alternative_exercise_id, similarity, volume_factor, conversion_note)
     SELECT $1, $2, $3, $4, $5
      WHERE EXISTS (SELECT 1 FROM gym.exercises WHERE id = $1)
        AND EXISTS (SELECT 1 FROM gym.exercises WHERE id = $2)
     ON CONFLICT (original_exercise_id, alternative_exercise_id)
     DO UPDATE SET similarity = EXCLUDED.similarity, volume_factor = EXCLUDED.volume_factor,
                   conversion_note = EXCLUDED.conversion_note
     RETURNING id`,
    [r.original_exercise_id, r.alternative_exercise_id, r.similarity, r.volume_factor, r.conversion_note]
  );
  if (!rows[0]) throw ApiError.notFound("Latihan tidak ditemukan");
  return rows[0];
}

export async function deleteSubstitution(id: string): Promise<void> {
  const { rowCount } = await getPool().query(`DELETE FROM gym.substitution_rules WHERE id = $1`, [id]);
  if (!rowCount) throw ApiError.notFound("Substitusi tidak ditemukan");
}
