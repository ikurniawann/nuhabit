import { profile } from "@/lib/gym/athlete-server";
import { athleteRoute, uuidParam, type IdCtx } from "@/lib/gym/athlete-route";
import { memberJson } from "@/lib/member-portal/route";

/** GET — profil atlet: follow, total, dan aktivitas yang boleh dilihat. */
export const GET = athleteRoute(
  "Gagal memuat profil atlet",
  async (customerId, _request: Request, ctx: IdCtx<"memberId">) =>
    memberJson(await profile(customerId, await uuidParam(ctx, "memberId"))),
);
