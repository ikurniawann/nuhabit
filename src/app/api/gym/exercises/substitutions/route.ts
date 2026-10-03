import { z } from "zod";
import { getPool } from "@/lib/db";
import { fail, gymStaffRoute, ok, uuidParam } from "@/lib/gym/training-route";
import { IAM } from "@/lib/iam/prefixes";

const ruleSchema = z
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

/** POST — buat atau perbarui aturan substitusi untuk pasangan latihan. */
export const POST = gymStaffRoute(IAM.gymExercises, "Gagal menyimpan substitusi", async (_userId, request: Request) => {
  const r = ruleSchema.parse(await request.json());
  const { rows } = await getPool().query(
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
  if (!rows[0]) return fail("Latihan tidak ditemukan", 404);
  return ok(rows[0]);
});

/** DELETE ?id= — hapus satu aturan substitusi. */
export const DELETE = gymStaffRoute(IAM.gymExercises, "Gagal menghapus substitusi", async (_userId, request: Request) => {
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!uuidParam.safeParse(id).success) return fail("ID tidak valid");
  const { rowCount } = await getPool().query(`DELETE FROM gym.substitution_rules WHERE id = $1`, [id]);
  if (!rowCount) return fail("Substitusi tidak ditemukan", 404);
  return ok({ id });
});
