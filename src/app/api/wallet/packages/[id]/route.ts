import { z } from "zod";
import { getPool } from "@/lib/db";
import { IAM } from "@/lib/iam/prefixes";
import { packageInputSchema } from "@/lib/wallet/packages";
import { fail, ok, walletRoute } from "@/lib/wallet/route";
import { savePackage } from "@/lib/wallet/topup";

type Ctx = { params: Promise<{ id: string }> };

/** PUT — ubah paket. */
export const PUT = walletRoute(IAM.posWallet, "Gagal menyimpan paket", async (user, request: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) return fail("ID tidak valid");
  const input = packageInputSchema.parse(await request.json());
  return ok(await savePackage(id, input, user.id));
});

/** DELETE — nonaktifkan paket (riwayat top-up tetap menunjuk ke paket ini). */
export const DELETE = walletRoute(IAM.posWallet, "Gagal menonaktifkan paket", async (user, _request: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) return fail("ID tidak valid");
  const { rowCount } = await getPool().query(
    `UPDATE pos.pos_topup_packages SET is_active = false, updated_by = $2, updated_at = now() WHERE id = $1`,
    [id, user.id]
  );
  return rowCount ? ok({ id }) : fail("Paket tidak ditemukan", 404);
});
