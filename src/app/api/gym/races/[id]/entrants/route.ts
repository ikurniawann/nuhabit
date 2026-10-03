import { getPool } from "@/lib/db";
import { fail, gymStaffRoute, ok, uuidParam } from "@/lib/gym/training-route";
import { IAM } from "@/lib/iam/prefixes";

type Ctx = { params: Promise<{ id: string }> };

/** GET — member yang menargetkan race ini: divisi, target, hasil. */
export const GET = gymStaffRoute(IAM.gymRaces, "Gagal memuat peserta race", async (_userId, _request: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  if (!uuidParam.safeParse(id).success) return fail("ID tidak valid");
  const { rows } = await getPool().query(
    `SELECT r.id, r.customer_id, c.name, c.phone, r.division, r.goal_sec, r.result_sec, r.status, r.created_at
       FROM gym.member_races r JOIN pos.pos_customers c ON c.id = r.customer_id
      WHERE r.race_event_id = $1
      ORDER BY (r.status = 'cancelled'), r.result_sec NULLS LAST, r.created_at`,
    [id]
  );
  return ok(rows);
});
