import { z } from "zod";
import { IAM } from "@/lib/iam/prefixes";
import { loadOnlinePayment } from "@/lib/wallet/payments";
import { fail, ok, walletRoute } from "@/lib/wallet/route";

/** GET — detail pembayaran online beserta bonus, refund, dan pembatalannya. */
export const GET = walletRoute(
  IAM.posWallet,
  "Gagal memuat pembayaran",
  async (_user, _request: Request, ctx: { params: Promise<{ id: string }> }) => {
    const { id } = await ctx.params;
    if (!z.string().uuid().safeParse(id).success) return fail("ID tidak valid");
    return ok(await loadOnlinePayment(id));
  }
);
