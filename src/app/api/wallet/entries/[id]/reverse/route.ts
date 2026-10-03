import { z } from "zod";
import { IAM } from "@/lib/iam/prefixes";
import { actorOf, fail, ok, walletRoute } from "@/lib/wallet/route";
import { reverseEntry } from "@/lib/wallet/server";

/** POST — batalkan satu entri dompet (sekali saja, tidak boleh membuat saldo minus). */
export const POST = walletRoute(
  IAM.posWallet,
  "Gagal membatalkan entri",
  async (user, request: Request, ctx: { params: Promise<{ id: string }> }) => {
    const { id } = await ctx.params;
    if (!z.string().uuid().safeParse(id).success) return fail("ID tidak valid");
    const { reason } = z.object({ reason: z.string().max(300) }).parse(await request.json());
    return ok(await reverseEntry({ entryId: id, reason, actor: actorOf(user) }), 201);
  }
);
