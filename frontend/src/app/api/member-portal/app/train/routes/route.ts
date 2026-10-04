import { routes, saveRoute } from "@/lib/gym/athlete-server";
import {
  athleteRoute,
  parseBody,
  saveRouteSchema,
} from "@/lib/gym/athlete-route";
import { memberJson } from "@/lib/member-portal/route";

/** GET — rute tersimpan saya. */
export const GET = athleteRoute("Gagal memuat rute", async (customerId) =>
  memberJson(await routes(customerId)),
);

/** POST — simpan jejak aktivitas sendiri sebagai rute. */
export const POST = athleteRoute(
  "Gagal menyimpan rute",
  async (customerId, request: Request) => {
    const { activityId, name } = await parseBody(
      request,
      saveRouteSchema,
      "Nama rute 2-80 karakter",
    );
    return memberJson(await saveRoute(customerId, activityId, name));
  },
);
