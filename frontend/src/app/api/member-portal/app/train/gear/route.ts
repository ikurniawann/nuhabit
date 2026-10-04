import { gearList, upsertGear } from "@/lib/gym/athlete-server";
import { athleteRoute, gearSchema, parseBody } from "@/lib/gym/athlete-route";
import { memberJson } from "@/lib/member-portal/route";

/** GET — sepatu dan sepeda saya beserta mileage. */
export const GET = athleteRoute("Gagal memuat gear", async (customerId) =>
  memberJson(await gearList(customerId)),
);

/** POST — tambah gear. */
export const POST = athleteRoute(
  "Gagal menambah gear",
  async (customerId, request: Request) => {
    const input = await parseBody(
      request,
      gearSchema,
      "Nama gear 2-60 karakter, jenis SHOES atau BIKE",
    );
    return memberJson(await upsertGear(customerId, null, input));
  },
);
