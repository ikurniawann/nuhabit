import { z } from "zod";
import { loadRaceEvent } from "@/lib/member-app/workout-server";
import { memberError, memberJson, withMemberSession } from "@/lib/member-portal/route";

type Ctx = { params: Promise<{ id: string }> };

/** GET — detail satu race + entri race member di race itu. */
export const GET = withMemberSession("Gagal memuat race", async (customerId, _request: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) return memberError("ID tidak valid");
  const race = await loadRaceEvent(customerId, id);
  if (!race) return memberError("Race tidak ditemukan", 404);
  return memberJson(race);
});
