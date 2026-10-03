import { upsertGear } from "@/lib/gym/athlete-server";
import {
  athleteRoute,
  gearSchema,
  parseBody,
  uuidParam,
  type IdCtx,
} from "@/lib/gym/athlete-route";
import { memberJson } from "@/lib/member-portal/route";

/** PATCH — ganti nama, jenis, atau pensiunkan gear (mileage tidak bisa diubah). */
export const PATCH = athleteRoute(
  "Gagal memperbarui gear",
  async (customerId, request: Request, ctx: IdCtx) => {
    const id = await uuidParam(ctx, "id");
    const input = await parseBody(
      request,
      gearSchema,
      "Nama gear 2-60 karakter, jenis SHOES atau BIKE",
    );
    return memberJson(await upsertGear(customerId, id, input));
  },
);
