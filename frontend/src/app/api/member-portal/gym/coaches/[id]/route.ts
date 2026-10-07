import { getPool } from "@/lib/db";
import { listSessions } from "@/lib/gym/booking-server";
import { memberSchedulingRoute, uuid } from "@/lib/gym/scheduling-route";
import { memberError, memberJson } from "@/lib/member-portal/route";

type Ctx = { params: Promise<{ id: string }> };

/** GET — profil coach + kelas terbitnya dalam 14 hari ke depan (dengan status booking member). */
export const GET = memberSchedulingRoute("Gagal memuat coach", async (customerId, _request: Request, ctx: Ctx) => {
  const id = uuid.safeParse((await ctx.params).id);
  if (!id.success) return memberError("ID coach tidak valid");
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT id, name, bio, specialization, photo_url FROM gym.coaches WHERE id = $1 AND status = 'active'`,
    [id.data]
  );
  if (!rows[0]) return memberError("Coach tidak ditemukan", 404);
  const now = new Date();
  const sessions = await listSessions(pool, {
    from: now,
    to: new Date(now.getTime() + 14 * 86_400_000),
    coachId: id.data,
    statuses: ["published", "full"],
    customerId,
  });
  return memberJson({ ...rows[0], sessions });
});
