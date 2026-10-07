import type { NextRequest } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { ok, requireWalletAdmin } from "@/lib/wallet/route";
import { searchMembers } from "@/lib/wallet/server";

/** GET ?q= — cari member (nama/telepon) beserta saldonya. */
export const GET = apiHandler(async (request: NextRequest) => {
  await requireWalletAdmin();
  return ok(await searchMembers(request.nextUrl.searchParams.get("q") ?? ""));
}, "wallet.members.GET");
