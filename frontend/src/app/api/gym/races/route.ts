import type { NextRequest } from "next/server";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { deleteRaceEvent, listRaceEvents, raceSchema, saveRaceEvent } from "@/lib/gym/race-admin-server";
import { ok, parseBody, requireUuid } from "@/lib/gym/staff-route";
import { IAM } from "@/lib/iam/prefixes";

/** GET: semua race, yang mendatang dulu, dengan jumlah peserta member. */
export const GET = apiHandler(async () => {
  await requireIamMenuPrefix(IAM.gymRaces);
  return ok(await listRaceEvents());
}, "gym.races.GET");

/** POST: buat atau ubah race. */
export const POST = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.gymRaces);
  const input = await parseBody(request, raceSchema);
  return ok(await saveRaceEvent(input));
}, "gym.races.POST");

/** DELETE ?id=: race tanpa peserta dihapus; yang sudah punya peserta dibatalkan. */
export const DELETE = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.gymRaces);
  const id = requireUuid(request.nextUrl.searchParams.get("id"));
  return ok({ id, outcome: await deleteRaceEvent(id) });
}, "gym.races.DELETE");
