import type { NextRequest } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { listOnlinePayments, paymentFiltersSchema } from "@/lib/wallet/payments";
import { ok, parseInput, requireWalletAdmin } from "@/lib/wallet/route";

/** GET — top-up QRIS online (kasir & portal) dengan filter status/sumber/tanggal/cari. */
export const GET = apiHandler(async (request: NextRequest) => {
  await requireWalletAdmin();
  const params = Object.fromEntries(
    [...request.nextUrl.searchParams.entries()].filter(([, value]) => value !== "")
  );
  return ok(await listOnlinePayments(parseInput(paymentFiltersSchema, params)));
}, "wallet.payments.GET");
