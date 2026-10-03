import { z } from "zod";
import { getPool } from "@/lib/db";
import { fail, gymAdminRoute, ok, uuidParam } from "@/lib/gym/credits-admin-route";
import { IAM } from "@/lib/iam/prefixes";

type Ctx = { params: Promise<{ id: string }> };

const statusSchema = z.object({ status: z.enum(["active", "archived"]) });

/** PATCH { status } — arsipkan (berhenti dijual) atau aktifkan lagi. */
export const PATCH = gymAdminRoute(IAM.gymPackages, "Gagal mengubah status paket", async (_user, request: Request, ctx: Ctx) => {
  const id = uuidParam.parse((await ctx.params).id);
  const { status } = statusSchema.parse(await request.json());
  const { rows } = await getPool().query(
    `UPDATE gym.credit_packages SET status = $2, updated_at = now() WHERE id = $1 RETURNING id, status`,
    [id, status]
  );
  if (!rows[0]) return fail("Paket tidak ditemukan", 404);
  return ok(rows[0]);
});

/**
 * DELETE — hapus paket yang belum pernah dibeli. Paket dengan riwayat
 * pembelian/lot hanya bisa diarsipkan supaya riwayat lama tetap terbaca.
 */
export const DELETE = gymAdminRoute(IAM.gymPackages, "Gagal menghapus paket", async (_user, _request: Request, ctx: Ctx) => {
  const id = uuidParam.parse((await ctx.params).id);
  const { rows } = await getPool().query(
    `DELETE FROM gym.credit_packages p
      WHERE p.id = $1
        AND NOT EXISTS (SELECT 1 FROM gym.credit_purchases WHERE package_id = p.id)
        AND NOT EXISTS (SELECT 1 FROM gym.credit_lots WHERE package_id = p.id)
      RETURNING id`,
    [id]
  );
  if (rows[0]) return ok({ id, deleted: true });
  const { rowCount } = await getPool().query(`SELECT 1 FROM gym.credit_packages WHERE id = $1`, [id]);
  return rowCount
    ? fail("Paket sudah pernah dibeli. Arsipkan saja agar riwayat tetap utuh.", 409)
    : fail("Paket tidak ditemukan", 404);
});
