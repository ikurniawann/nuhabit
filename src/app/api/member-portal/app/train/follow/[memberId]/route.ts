import { toggleFollow } from "@/lib/gym/athlete-server";
import { athleteRoute, uuidParam, type IdCtx } from "@/lib/gym/athlete-route";
import { memberJson } from "@/lib/member-portal/route";

/** POST — ikuti atau berhenti mengikuti atlet. */
export const POST = athleteRoute(
  "Gagal memperbarui follow",
  async (customerId, _request: Request, ctx: IdCtx<"memberId">) =>
    memberJson(
      await toggleFollow(customerId, await uuidParam(ctx, "memberId")),
    ),
);
