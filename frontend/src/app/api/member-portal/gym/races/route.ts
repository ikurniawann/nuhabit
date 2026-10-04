import { z } from "zod";
import { DIVISIONS } from "@/lib/gym/hyrox";
import { memberRaceOverview, registerForRace } from "@/lib/gym/races-server";
import { memberError, memberJson, withMemberSession } from "@/lib/member-portal/route";

const registerSchema = z.object({
  race_event_id: z.string().uuid(),
  division: z.enum(DIVISIONS),
  goal_sec: z.number().int().positive().max(6 * 3600).nullable().default(null),
});

/** GET — race mendatang, race saya, prediksi waktu, kesiapan 28 hari, dan analisis hasil. */
export const GET = withMemberSession("Gagal memuat race", async (customerId) => memberJson(await memberRaceOverview(customerId)));

/** POST — targetkan race: divisi + target waktu (opsional). */
export const POST = withMemberSession("Gagal mendaftar race", async (customerId, request: Request) => {
  const parsed = registerSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return memberError("Data race tidak valid");
  const outcome = await registerForRace(customerId, {
    raceEventId: parsed.data.race_event_id,
    division: parsed.data.division,
    goalSec: parsed.data.goal_sec,
  });
  if (!outcome.ok) return memberError(outcome.error, outcome.status);
  return memberJson({ id: outcome.id });
});
