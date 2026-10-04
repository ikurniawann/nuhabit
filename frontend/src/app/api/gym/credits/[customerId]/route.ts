import type { NextRequest } from "next/server";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { loadMemberCredits } from "@/lib/gym/credits-admin-server";
import { ok, requireUuid } from "@/lib/gym/staff-route";
import { IAM } from "@/lib/iam/prefixes";

type Ctx = { params: Promise<{ customerId: string }> };

/** GET: profil singkat, saldo, lot, kredit segera kedaluwarsa, buku besar, dan pembelian member. */
export const GET = apiHandler(async (_request: NextRequest, ctx: Ctx) => {
  await requireIamMenuPrefix(IAM.gymCredits);
  const customerId = requireUuid((await ctx.params).customerId);
  return ok(await loadMemberCredits(customerId));
}, "gym.credits.[customerId].GET");
