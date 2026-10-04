import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiHandler } from "@/lib/api/handler";
import { actorOf, ok, parseInput, requireWalletAdmin, uuidParam, type IdContext } from "@/lib/wallet/route";
import { applyAdjustment } from "@/lib/wallet/server";

const schema = z.object({ amount: z.number(), reason: z.string().max(300) });

/** POST — penyesuaian saldo manual bertanda (+ menambah, − mengurangi), alasan wajib. */
export const POST = apiHandler(async (request: NextRequest, ctx: IdContext) => {
  const user = await requireWalletAdmin();
  const customerId = await uuidParam(ctx);
  const input = parseInput(schema, await request.json());
  return ok(await applyAdjustment({ customerId, ...input, actor: actorOf(user) }), 201);
}, "wallet.members.adjust.POST");
