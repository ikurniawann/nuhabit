import { getPool } from "@/lib/db";
import { IAM } from "@/lib/iam/prefixes";
import { getCreditBalance } from "@/lib/gym/credits-server";
import { ok, schedulingRoute } from "@/lib/gym/scheduling-route";

/** GET ?q= — cari member (nama/telepon) untuk didaftarkan ke kelas, dengan saldo kredit. */
export const GET = schedulingRoute(IAM.gymScheduling, "Gagal mencari member", async (_userId, request: Request) => {
  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return ok([]);
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT id, name, phone, is_active FROM pos.pos_customers
      WHERE name ILIKE '%' || $1 || '%' OR phone ILIKE '%' || $1 || '%'
      ORDER BY name LIMIT 10`,
    [q]
  );
  const withBalance = await Promise.all(
    rows.map(async (row) => ({ ...row, credits: await getCreditBalance(pool, row.id) }))
  );
  return ok(withBalance);
});
