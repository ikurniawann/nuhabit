import type { NextRequest } from "next/server";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { deleteScheme, loadSchemeForm, saveScheme, schemeSchema } from "@/lib/gym/incentive-server";
import { ok, parseBody, requireUuid } from "@/lib/gym/staff-route";
import { IAM } from "@/lib/iam/prefixes";

/** GET: skema (default dulu) + daftar coach dan jenis kelas untuk form. */
export const GET = apiHandler(async () => {
  await requireIamMenuPrefix(IAM.gymIncentives);
  return ok(await loadSchemeForm());
}, "gym.incentives.schemes.GET");

/** POST: buat atau ubah skema; tarif per jenis kelas diganti seluruhnya. */
export const POST = apiHandler(async (request: NextRequest) => {
  const user = await requireIamMenuPrefix(IAM.gymIncentives);
  const input = await parseBody(request, schemeSchema);
  return ok({ id: await saveScheme(input, user.id) });
}, "gym.incentives.schemes.POST");

/** DELETE ?id=: hapus skema khusus coach; coach kembali memakai skema default. */
export const DELETE = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.gymIncentives);
  const id = requireUuid(request.nextUrl.searchParams.get("id"));
  await deleteScheme(id);
  return ok({ id });
}, "gym.incentives.schemes.DELETE");
