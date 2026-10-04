import { segmentDetail } from "@/lib/gym/athlete-server";
import { athleteRoute, uuidParam, type IdCtx } from "@/lib/gym/athlete-route";
import { memberJson } from "@/lib/member-portal/route";

/** GET — segment + leaderboard (effort terbaik per atlet, 20 teratas). */
export const GET = athleteRoute(
  "Gagal memuat segment",
  async (customerId, _request: Request, ctx: IdCtx) =>
    memberJson(await segmentDetail(customerId, await uuidParam(ctx, "id"))),
);
