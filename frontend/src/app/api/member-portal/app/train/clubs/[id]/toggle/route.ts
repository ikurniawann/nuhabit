import { toggleClub } from "@/lib/gym/athlete-server";
import { athleteRoute, uuidParam, type IdCtx } from "@/lib/gym/athlete-route";
import { memberJson } from "@/lib/member-portal/route";

/** POST — gabung atau keluar klub. */
export const POST = athleteRoute(
  "Gagal memperbarui klub",
  async (customerId, _request: Request, ctx: IdCtx) =>
    memberJson(await toggleClub(customerId, await uuidParam(ctx, "id"))),
);
