import { z } from "zod";
import { RACE_REGIONS } from "@/lib/gym/races";
import { listRaceEvents } from "@/lib/member-app/workout-server";
import { memberError, memberJson, withMemberSession } from "@/lib/member-portal/route";

const querySchema = z.object({
  scope: z.enum(["upcoming", "results"]).default("upcoming"),
  region: z.enum(RACE_REGIONS).nullable().default(null),
});

/** GET ?scope=upcoming|results&region= — kalender race beserta status ikut & jumlah peserta studio. */
export const GET = withMemberSession("Gagal memuat race", async (customerId, request: Request) => {
  const params = new URL(request.url).searchParams;
  const parsed = querySchema.safeParse({ scope: params.get("scope") ?? undefined, region: params.get("region") || null });
  if (!parsed.success) return memberError("Filter race tidak valid");
  return memberJson(await listRaceEvents(customerId, { results: parsed.data.scope === "results", region: parsed.data.region }));
});
