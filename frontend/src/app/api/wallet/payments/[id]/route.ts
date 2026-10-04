import type { NextRequest } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { loadOnlinePayment } from "@/lib/wallet/payments";
import { ok, requireWalletAdmin, uuidParam, type IdContext } from "@/lib/wallet/route";

/** GET — detail pembayaran online beserta bonus, refund, dan pembatalannya. */
export const GET = apiHandler(async (_request: NextRequest, ctx: IdContext) => {
  await requireWalletAdmin();
  return ok(await loadOnlinePayment(await uuidParam(ctx)));
}, "wallet.payments.id.GET");
