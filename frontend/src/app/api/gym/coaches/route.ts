import type { NextRequest } from "next/server";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { createCoach, listCoaches } from "@/lib/gym/catalog-server";
import { coachSchema } from "@/lib/gym/scheduling-schemas";
import { ok, parseBody } from "@/lib/gym/staff-route";
import { IAM } from "@/lib/iam/prefixes";

/** GET: coach + sesi mendatang (14 hari) dan kelas yang sudah dipimpin. */
export const GET = apiHandler(async () => {
  await requireIamMenuPrefix(IAM.gymScheduling);
  return ok(await listCoaches());
}, "gym.coaches.GET");

export const POST = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.gymScheduling);
  const input = await parseBody(request, coachSchema);
  return ok(await createCoach(input));
}, "gym.coaches.POST");
