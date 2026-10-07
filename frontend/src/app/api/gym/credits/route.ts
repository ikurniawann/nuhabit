import type { NextRequest } from "next/server";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { searchCreditMembers } from "@/lib/gym/credits-admin-server";
import { ok } from "@/lib/gym/staff-route";
import { IAM } from "@/lib/iam/prefixes";

/**
 * GET ?q=: cari member (nama/telepon) beserta saldo kredit. Tanpa q:
 * 20 member dengan aktivitas kredit terbaru.
 */
export const GET = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.gymCredits);
  const q = (request.nextUrl.searchParams.get("q") ?? "").trim();
  return ok(await searchCreditMembers(q));
}, "gym.credits.GET");
