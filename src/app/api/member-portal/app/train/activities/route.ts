import { myActivities, saveActivity } from "@/lib/gym/athlete-server";
import {
  athleteRoute,
  parseBody,
  saveActivitySchema,
} from "@/lib/gym/athlete-route";
import { memberJson } from "@/lib/member-portal/route";

/** GET — semua aktivitas saya, terbaru dulu. */
export const GET = athleteRoute("Gagal memuat aktivitas", async (customerId) =>
  memberJson(await myActivities(customerId)),
);

/** POST — simpan aktivitas hasil rekam (statistik dihitung ulang dari jejak GPS). */
export const POST = athleteRoute(
  "Gagal menyimpan aktivitas",
  async (customerId, request: Request) => {
    const input = await parseBody(
      request,
      saveActivitySchema,
      "Data aktivitas tidak valid",
    );
    return memberJson(await saveActivity(customerId, input));
  },
);
