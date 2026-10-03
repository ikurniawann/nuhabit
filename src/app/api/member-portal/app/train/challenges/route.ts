import { challenges } from "@/lib/gym/athlete-server";
import { athleteRoute } from "@/lib/gym/athlete-route";
import { memberJson } from "@/lib/member-portal/route";

/** GET — tantangan km yang masih berjalan, progres saya, dan leaderboard. */
export const GET = athleteRoute("Gagal memuat tantangan", async (customerId) =>
  memberJson(await challenges(customerId)),
);
