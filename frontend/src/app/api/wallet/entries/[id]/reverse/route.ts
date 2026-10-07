import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiHandler } from "@/lib/api/handler";
import { actorOf, ok, parseInput, requireWalletAdmin, uuidParam, type IdContext } from "@/lib/wallet/route";
import { reverseEntry } from "@/lib/wallet/server";

const schema = z.object({ reason: z.string().max(300) });

/** POST — batalkan satu entri dompet (sekali saja, tidak boleh membuat saldo minus). */
export const POST = apiHandler(async (request: NextRequest, ctx: IdContext) => {
  const user = await requireWalletAdmin();
  const entryId = await uuidParam(ctx);
  const { reason } = parseInput(schema, await request.json());
  return ok(await reverseEntry({ entryId, reason, actor: actorOf(user) }), 201);
}, "wallet.entries.reverse.POST");
