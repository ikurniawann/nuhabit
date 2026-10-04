import {
  activityDetail,
  deleteActivity,
  updateActivity,
} from "@/lib/gym/athlete-server";
import {
  athleteRoute,
  parseBody,
  updateActivitySchema,
  uuidParam,
  type IdCtx,
} from "@/lib/gym/athlete-route";
import { memberJson } from "@/lib/member-portal/route";

/** GET — detail aktivitas: jejak, split, effort segment, komentar, latihan bareng. */
export const GET = athleteRoute(
  "Gagal memuat aktivitas",
  async (customerId, _request: Request, ctx: IdCtx) =>
    memberJson(await activityDetail(customerId, await uuidParam(ctx, "id"))),
);

/** PATCH — ubah judul, deskripsi, visibilitas, atau gear aktivitas sendiri. */
export const PATCH = athleteRoute(
  "Gagal memperbarui aktivitas",
  async (customerId, request: Request, ctx: IdCtx) => {
    const id = await uuidParam(ctx, "id");
    const patch = await parseBody(
      request,
      updateActivitySchema,
      "Data aktivitas tidak valid",
    );
    return memberJson(await updateActivity(customerId, id, patch));
  },
);

/** DELETE — hapus aktivitas sendiri (mileage gear ikut dikurangi). */
export const DELETE = athleteRoute(
  "Gagal menghapus aktivitas",
  async (customerId, _request: Request, ctx: IdCtx) => {
    await deleteActivity(customerId, await uuidParam(ctx, "id"));
    return memberJson({ deleted: true });
  },
);
