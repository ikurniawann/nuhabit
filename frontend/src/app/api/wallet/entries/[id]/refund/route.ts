import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiHandler } from "@/lib/api/handler";
import { REFUND_METHODS } from "@/lib/wallet/corrections";
import { actorOf, ok, parseInput, requireWalletAdmin, uuidParam, type IdContext } from "@/lib/wallet/route";
import { refundTopup } from "@/lib/wallet/server";

const schema = z.object({
  method: z.enum(REFUND_METHODS),
  reference: z.string().max(100).default(""),
  reason: z.string().max(300),
});

/** POST — refund satu top-up selesai: kredit + bonus ditarik, uang dikembalikan manual. */
export const POST = apiHandler(async (request: NextRequest, ctx: IdContext) => {
  const user = await requireWalletAdmin();
  const topupId = await uuidParam(ctx);
  const input = parseInput(schema, await request.json());
  return ok(await refundTopup({ topupId, ...input, actor: actorOf(user) }), 201);
}, "wallet.entries.refund.POST");
