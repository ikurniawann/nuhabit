import { stats } from "@/lib/gym/athlete-server";
import { athleteRoute } from "@/lib/gym/athlete-route";
import { memberJson } from "@/lib/member-portal/route";

/** GET — layar "You": grafik 8 minggu, total, target mingguan, rekor, gear, follow. */
export const GET = athleteRoute("Gagal memuat statistik", async (customerId) =>
  memberJson(await stats(customerId)),
);
