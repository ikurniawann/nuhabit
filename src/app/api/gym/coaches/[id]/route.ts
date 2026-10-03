import { getPool } from "@/lib/db";
import { IAM } from "@/lib/iam/prefixes";
import { fail, ok, schedulingRoute, uuid } from "@/lib/gym/scheduling-route";
import { coachSchema } from "@/lib/gym/scheduling-schemas";

type Ctx = { params: Promise<{ id: string }> };

/** PATCH — ubah profil atau nonaktifkan coach. Kolom yang tidak dikirim tetap. */
export const PATCH = schedulingRoute(IAM.gymScheduling, "Gagal mengubah coach", async (_userId, request: Request, ctx: Ctx) => {
  const id = uuid.parse((await ctx.params).id);
  const body = await request.json();
  const input = coachSchema.partial().parse(body);
  const has = (key: string) => Object.prototype.hasOwnProperty.call(body, key);
  const { rows } = await getPool().query(
    `UPDATE gym.coaches SET
        name = COALESCE($2, name), bio = COALESCE($3, bio), specialization = COALESCE($4, specialization),
        photo_url = CASE WHEN $8 THEN $5 ELSE photo_url END,
        branch_id = CASE WHEN $9 THEN $6 ELSE branch_id END,
        status = COALESCE($7, status), updated_at = now()
      WHERE id = $1 RETURNING id`,
    [id, input.name, input.bio, input.specialization, input.photo_url ?? null, input.branch_id ?? null,
      input.status, has("photo_url"), has("branch_id")]
  );
  if (!rows[0]) return fail("Coach tidak ditemukan", 404);
  return ok(rows[0]);
});
