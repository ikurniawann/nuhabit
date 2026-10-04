import { social } from "@/lib/gym/athlete-server";
import { athleteRoute } from "@/lib/gym/athlete-route";
import { memberJson } from "@/lib/member-portal/route";

/** GET ?q= — following, followers, dan saran follow (atau hasil cari nama atlet). */
export const GET = athleteRoute(
  "Gagal memuat atlet",
  async (customerId, request: Request) => {
    const q = (new URL(request.url).searchParams.get("q") ?? "").slice(0, 60);
    return memberJson(await social(customerId, q));
  },
);
