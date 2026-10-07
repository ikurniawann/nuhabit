import { toggleKudos } from "@/lib/gym/athlete-server";
import { athleteRoute, uuidParam, type IdCtx } from "@/lib/gym/athlete-route";
import { memberJson } from "@/lib/member-portal/route";

/** POST — beri atau tarik kudos. */
export const POST = athleteRoute(
  "Gagal memberi kudos",
  async (customerId, _request: Request, ctx: IdCtx) =>
    memberJson(await toggleKudos(customerId, await uuidParam(ctx, "id"))),
);
