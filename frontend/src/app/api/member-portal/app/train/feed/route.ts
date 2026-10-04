import { feed } from "@/lib/gym/athlete-server";
import { athleteRoute } from "@/lib/gym/athlete-route";
import { memberJson } from "@/lib/member-portal/route";

/** GET ?scope=everyone|following — aktivitas yang boleh dilihat, terbaru dulu. */
export const GET = athleteRoute(
  "Gagal memuat feed",
  async (customerId, request: Request) => {
    const scope = new URL(request.url).searchParams.get("scope");
    return memberJson(await feed(customerId, scope === "following"));
  },
);
