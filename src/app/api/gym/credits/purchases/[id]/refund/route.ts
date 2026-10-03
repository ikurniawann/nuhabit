import { z } from "zod";
import { withTransaction } from "@/lib/db";
import { gymAdminRoute, ok, uuidParam } from "@/lib/gym/credits-admin-route";
import { refundCreditPurchase } from "@/lib/gym/credit-purchases-server";
import { IAM } from "@/lib/iam/prefixes";

type Ctx = { params: Promise<{ id: string }> };

const schema = z.object({ reason: z.string().trim().min(3, "Alasan refund wajib diisi").max(500) });

/**
 * POST { reason } — refund pembelian lunas: kreditnya dibatalkan lewat
 * reversal. ARK Coin kembali otomatis; tunai/kartu/transfer dikembalikan kasir.
 */
export const POST = gymAdminRoute(IAM.gymCredits, "Gagal merefund pembelian", async (user, request: Request, ctx: Ctx) => {
  const id = uuidParam.parse((await ctx.params).id);
  const { reason } = schema.parse(await request.json());
  const purchase = await withTransaction((client) => refundCreditPurchase(client, id, { reason, actorId: user.id }));
  return ok(purchase);
});
