import { joinChallenge, leaveChallenge } from "@/lib/gym/athlete-server";
import { athleteRoute, uuidParam, type IdCtx } from "@/lib/gym/athlete-route";
import { memberJson } from "@/lib/member-portal/route";

/** POST — ikut tantangan (idempoten). */
export const POST = athleteRoute(
  "Gagal ikut tantangan",
  async (customerId, _request: Request, ctx: IdCtx) => {
    await joinChallenge(customerId, await uuidParam(ctx, "id"));
    return memberJson({ joined: true });
  },
);

/** DELETE — keluar dari tantangan. */
export const DELETE = athleteRoute(
  "Gagal keluar dari tantangan",
  async (customerId, _request: Request, ctx: IdCtx) => {
    await leaveChallenge(customerId, await uuidParam(ctx, "id"));
    return memberJson({ joined: false });
  },
);
