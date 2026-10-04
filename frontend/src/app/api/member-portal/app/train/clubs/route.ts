import { clubs } from "@/lib/gym/athlete-server";
import { athleteRoute } from "@/lib/gym/athlete-route";
import { memberJson } from "@/lib/member-portal/route";

/** GET — klub, keanggotaan saya, dan papan km minggu ini. */
export const GET = athleteRoute("Gagal memuat klub", async (customerId) =>
  memberJson(await clubs(customerId)),
);
