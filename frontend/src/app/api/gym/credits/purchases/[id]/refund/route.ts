import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { withTransaction } from "@/lib/db";
import { refundCreditPurchase } from "@/lib/gym/credit-purchases-server";
import { ok, parseBody, requireUuid } from "@/lib/gym/staff-route";
import { IAM } from "@/lib/iam/prefixes";

type Ctx = { params: Promise<{ id: string }> };

const schema = z.object({ reason: z.string().trim().min(3, "Alasan refund wajib diisi").max(500) });

/**
 * POST { reason }: refund pembelian lunas; kreditnya dibatalkan lewat
 * reversal. ARK Coin kembali otomatis; tunai/kartu/transfer dikembalikan kasir.
 */
export const POST = apiHandler(async (request: NextRequest, ctx: Ctx) => {
  const user = await requireIamMenuPrefix(IAM.gymCredits);
  const id = requireUuid((await ctx.params).id);
  const { reason } = await parseBody(request, schema, "issue");
  const purchase = await withTransaction((client) => refundCreditPurchase(client, id, { reason, actorId: user.id }));
  return ok(purchase);
}, "gym.credits.purchases.refund.POST");
