import type { NextRequest } from "next/server";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { createPgClient } from "@/lib/pg/create-client";
import { resolveTopupVenue } from "@/lib/pos/topup-venue";
import { packageInputSchema } from "@/lib/wallet/packages";
import { ok, parseInput, requireWalletAdmin } from "@/lib/wallet/route";
import { listPackages, savePackage } from "@/lib/wallet/topup";

/**
 * GET ?scope=cashier — paket aktif yang dijual di cabang kasir (gerbang menu POS);
 * tanpa scope = semua paket (admin dompet).
 */
export const GET = apiHandler(async (request: NextRequest) => {
  if (request.nextUrl.searchParams.get("scope") === "cashier") {
    const user = await requireIamMenuPrefix(IAM.pos);
    const venue = await resolveTopupVenue(createPgClient(), user.id);
    return ok(await listPackages("cashier", venue.branchId));
  }
  await requireWalletAdmin();
  return ok(await listPackages("admin"));
}, "wallet.packages.GET");

/** POST — paket baru. */
export const POST = apiHandler(async (request: NextRequest) => {
  const user = await requireWalletAdmin();
  const input = parseInput(packageInputSchema, await request.json());
  return ok(await savePackage(null, input, user.id), 201);
}, "wallet.packages.POST");
