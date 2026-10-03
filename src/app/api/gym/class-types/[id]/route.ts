import { getPool } from "@/lib/db";
import { SchedulingError } from "@/lib/gym/booking-server";
import { IAM } from "@/lib/iam/prefixes";
import { fail, ok, schedulingRoute, uuid } from "@/lib/gym/scheduling-route";
import { classTypeSchema } from "@/lib/gym/scheduling-schemas";

type Ctx = { params: Promise<{ id: string }> };

/** PATCH — ubah template. Sesi yang sudah dibuat tidak ikut berubah. */
export const PATCH = schedulingRoute(IAM.gymScheduling, "Gagal mengubah jenis kelas", async (_userId, request: Request, ctx: Ctx) => {
  const id = uuid.parse((await ctx.params).id);
  const input = classTypeSchema.partial().parse(await request.json());
  const { rows } = await getPool().query(
    `UPDATE gym.class_types SET
        name = COALESCE($2, name), description = COALESCE($3, description),
        default_duration_min = COALESCE($4, default_duration_min),
        default_credit_cost = COALESCE($5, default_credit_cost),
        default_capacity = COALESCE($6, default_capacity),
        color = COALESCE($7, color), status = COALESCE($8, status), updated_at = now()
      WHERE id = $1 RETURNING id`,
    [id, input.name, input.description, input.default_duration_min, input.default_credit_cost,
      input.default_capacity, input.color, input.status]
  ).catch((error) => {
    if (error.code === "23505") throw new SchedulingError("Nama jenis kelas sudah dipakai");
    throw error;
  });
  if (!rows[0]) return fail("Jenis kelas tidak ditemukan", 404);
  return ok(rows[0]);
});

/** DELETE — arsipkan (sesi lama tetap merujuk ke template ini). */
export const DELETE = schedulingRoute(IAM.gymScheduling, "Gagal mengarsipkan jenis kelas", async (_userId, _request: Request, ctx: Ctx) => {
  const id = uuid.parse((await ctx.params).id);
  const { rowCount } = await getPool().query(
    `UPDATE gym.class_types SET status = 'archived', updated_at = now() WHERE id = $1`,
    [id]
  );
  if (!rowCount) return fail("Jenis kelas tidak ditemukan", 404);
  return ok({ id });
});
