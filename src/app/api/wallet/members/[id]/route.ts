import { z } from "zod";
import { IAM } from "@/lib/iam/prefixes";
import { fail, ok, walletRoute } from "@/lib/wallet/route";
import { loadMemberWallet } from "@/lib/wallet/server";

/** GET — saldo, lot aktif (FIFO), dan 200 entri terakhir satu member. */
export const GET = walletRoute(
  IAM.posWallet,
  "Gagal memuat dompet member",
  async (_user, _request: Request, ctx: { params: Promise<{ id: string }> }) => {
    const { id } = await ctx.params;
    if (!z.string().uuid().safeParse(id).success) return fail("ID tidak valid");
    return ok(await loadMemberWallet(id));
  }
);
