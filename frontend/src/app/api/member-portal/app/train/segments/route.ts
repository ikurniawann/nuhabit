import { segments } from "@/lib/gym/athlete-server";
import { athleteRoute } from "@/lib/gym/athlete-route";
import { memberJson } from "@/lib/member-portal/route";

/** GET — semua segment dengan rekor, jumlah effort, dan peringkat saya. */
export const GET = athleteRoute("Gagal memuat segment", async (customerId) =>
  memberJson(await segments(customerId)),
);
