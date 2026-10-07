import type { NextRequest } from "next/server";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { deleteSubstitution, saveSubstitution, substitutionSchema } from "@/lib/gym/exercises-admin-server";
import { ok, parseBody, requireUuid } from "@/lib/gym/staff-route";
import { IAM } from "@/lib/iam/prefixes";

/** POST: buat atau perbarui aturan substitusi untuk pasangan latihan. */
export const POST = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.gymExercises);
  const input = await parseBody(request, substitutionSchema);
  return ok(await saveSubstitution(input));
}, "gym.exercises.substitutions.POST");

/** DELETE ?id=: hapus satu aturan substitusi. */
export const DELETE = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.gymExercises);
  const id = requireUuid(request.nextUrl.searchParams.get("id"));
  await deleteSubstitution(id);
  return ok({ id });
}, "gym.exercises.substitutions.DELETE");
