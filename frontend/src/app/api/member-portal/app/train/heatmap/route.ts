import { heatmap } from "@/lib/gym/athlete-server";
import { athleteRoute } from "@/lib/gym/athlete-route";
import { memberJson } from "@/lib/member-portal/route";

/** GET — semua jejak GPS saya (ditipiskan) untuk heatmap pribadi. */
export const GET = athleteRoute("Gagal memuat heatmap", async (customerId) =>
  memberJson(await heatmap(customerId)),
);
