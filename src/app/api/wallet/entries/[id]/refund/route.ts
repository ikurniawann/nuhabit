import { z } from "zod";
import { IAM } from "@/lib/iam/prefixes";
import { REFUND_METHODS } from "@/lib/wallet/corrections";
import { actorOf, fail, ok, walletRoute } from "@/lib/wallet/route";
import { refundTopup } from "@/lib/wallet/server";

const schema = z.object({
  method: z.enum(REFUND_METHODS),
  reference: z.string().max(100).default(""),
  reason: z.string().max(300),
});

/** POST — refund satu top-up selesai: kredit + bonus ditarik, uang dikembalikan manual. */
export const POST = walletRoute(
  IAM.posWallet,
  "Gagal merefund top-up",
  async (user, request: Request, ctx: { params: Promise<{ id: string }> }) => {
    const { id } = await ctx.params;
    if (!z.string().uuid().safeParse(id).success) return fail("ID tidak valid");
    const input = schema.parse(await request.json());
    return ok(await refundTopup({ topupId: id, ...input, actor: actorOf(user) }), 201);
  }
);
