import type { NextRequest } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { packageInputSchema } from "@/lib/wallet/packages";
import { ok, parseInput, requireWalletAdmin, uuidParam, type IdContext } from "@/lib/wallet/route";
import { deactivatePackage, savePackage } from "@/lib/wallet/topup";

/** PUT — ubah paket. */
export const PUT = apiHandler(async (request: NextRequest, ctx: IdContext) => {
  const user = await requireWalletAdmin();
  const id = await uuidParam(ctx);
  const input = parseInput(packageInputSchema, await request.json());
  return ok(await savePackage(id, input, user.id));
}, "wallet.packages.id.PUT");

/** DELETE — nonaktifkan paket (riwayat top-up tetap menunjuk ke paket ini). */
export const DELETE = apiHandler(async (_request: NextRequest, ctx: IdContext) => {
  const user = await requireWalletAdmin();
  const id = await uuidParam(ctx);
  await deactivatePackage(id, user.id);
  return ok({ id });
}, "wallet.packages.id.DELETE");
