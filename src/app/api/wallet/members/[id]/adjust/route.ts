import { z } from "zod";
import { IAM } from "@/lib/iam/prefixes";
import { actorOf, fail, ok, walletRoute } from "@/lib/wallet/route";
import { applyAdjustment } from "@/lib/wallet/server";

const schema = z.object({ amount: z.number(), reason: z.string().max(300) });

/** POST — penyesuaian saldo manual bertanda (+ menambah, − mengurangi), alasan wajib. */
export const POST = walletRoute(
  IAM.posWallet,
  "Gagal menyimpan penyesuaian",
  async (user, request: Request, ctx: { params: Promise<{ id: string }> }) => {
    const { id } = await ctx.params;
    if (!z.string().uuid().safeParse(id).success) return fail("ID tidak valid");
    const input = schema.parse(await request.json());
    return ok(await applyAdjustment({ customerId: id, ...input, actor: actorOf(user) }), 201);
  }
);
