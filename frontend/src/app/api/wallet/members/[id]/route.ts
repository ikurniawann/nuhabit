import type { NextRequest } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { ok, requireWalletAdmin, uuidParam, type IdContext } from "@/lib/wallet/route";
import { loadMemberWallet } from "@/lib/wallet/server";

/** GET — saldo, lot aktif (FIFO), dan 200 entri terakhir satu member. */
export const GET = apiHandler(async (_request: NextRequest, ctx: IdContext) => {
  await requireWalletAdmin();
  return ok(await loadMemberWallet(await uuidParam(ctx)));
}, "wallet.members.id.GET");
