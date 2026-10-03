import { getPool } from "@/lib/db";
import { IAM } from "@/lib/iam/prefixes";
import { ok, walletRoute } from "@/lib/wallet/route";

/** GET — cabang aktif, untuk membatasi paket top-up per cabang. */
export const GET = walletRoute(IAM.posWallet, "Gagal memuat cabang", async () => {
  const { rows } = await getPool().query(
    `SELECT id, name FROM configuration.branches WHERE is_active ORDER BY name`
  );
  return ok(rows);
});
