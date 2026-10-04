import { deleteRoute } from "@/lib/gym/athlete-server";
import { athleteRoute, uuidParam, type IdCtx } from "@/lib/gym/athlete-route";
import { memberJson } from "@/lib/member-portal/route";

/** DELETE — hapus rute milik sendiri. */
export const DELETE = athleteRoute(
  "Gagal menghapus rute",
  async (customerId, _request: Request, ctx: IdCtx) => {
    await deleteRoute(customerId, await uuidParam(ctx, "id"));
    return memberJson({ ok: true });
  },
);
