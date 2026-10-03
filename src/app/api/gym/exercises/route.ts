import { z } from "zod";
import { getPool } from "@/lib/db";
import { EXERCISE_CATEGORIES } from "@/lib/gym/hyrox";
import { fail, gymStaffRoute, isUniqueViolation, ok, uuidParam } from "@/lib/gym/training-route";
import { IAM } from "@/lib/iam/prefixes";

const exerciseSchema = z.object({
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

/** GET — pustaka latihan + aturan substitusi (dengan nama latihan). */
export const GET = gymStaffRoute(IAM.gymExercises, "Gagal memuat latihan", async () => {
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
  return ok({ exercises: exercises.rows, substitutions: substitutions.rows });
});

/** POST — buat atau ubah latihan. Nomor stasiun dan kode harus unik. */
export const POST = gymStaffRoute(IAM.gymExercises, "Gagal menyimpan latihan", async (_userId, request: Request) => {
  const e = exerciseSchema.parse(await request.json());
  const params = [
    e.code, e.name, e.description, e.category, e.equipment, e.hyrox_station_order, e.difficulty,
    JSON.stringify(e.default_spec), e.video_url, e.is_active,
  ];
  try {
    const { rows } = e.id
      ? await getPool().query(
          `UPDATE gym.exercises SET code=$1, name=$2, description=$3, category=$4, equipment=$5::text[],
                  hyrox_station_order=$6, difficulty=$7, default_spec=$8::jsonb, video_url=$9, is_active=$10,
                  updated_at=now()
            WHERE id=$11 RETURNING id`,
          [...params, e.id]
        )
      : await getPool().query(
          `INSERT INTO gym.exercises (code, name, description, category, equipment, hyrox_station_order, difficulty,
                                      default_spec, video_url, is_active)
           VALUES ($1,$2,$3,$4,$5::text[],$6,$7,$8::jsonb,$9,$10) RETURNING id`,
          params
        );
    if (!rows[0]) return fail("Latihan tidak ditemukan", 404);
    return ok(rows[0]);
  } catch (error) {
    if (isUniqueViolation(error)) return fail("Kode atau nomor stasiun sudah dipakai latihan lain", 409);
    throw error;
  }
});

/**
 * DELETE ?id= — hapus latihan beserta aturan substitusinya. Workout lama tetap
 * utuh karena bloknya menyimpan nama latihan.
 */
export const DELETE = gymStaffRoute(IAM.gymExercises, "Gagal menghapus latihan", async (_userId, request: Request) => {
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!uuidParam.safeParse(id).success) return fail("ID tidak valid");
  const { rowCount } = await getPool().query(`DELETE FROM gym.exercises WHERE id = $1`, [id]);
  if (!rowCount) return fail("Latihan tidak ditemukan", 404);
  return ok({ id });
});
