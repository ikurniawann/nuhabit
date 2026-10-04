import type { NextRequest } from "next/server";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { createClassType, listClassTypes } from "@/lib/gym/catalog-server";
import { classTypeSchema } from "@/lib/gym/scheduling-schemas";
import { ok, parseBody } from "@/lib/gym/staff-route";
import { IAM } from "@/lib/iam/prefixes";

/** GET: semua jenis kelas + jumlah sesi mendatang. */
export const GET = apiHandler(async () => {
  await requireIamMenuPrefix(IAM.gymScheduling);
  return ok(await listClassTypes());
}, "gym.class-types.GET");

/** POST: jenis kelas baru (template untuk sesi). */
export const POST = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.gymScheduling);
  const input = await parseBody(request, classTypeSchema);
  return ok(await createClassType(input));
}, "gym.class-types.POST");
