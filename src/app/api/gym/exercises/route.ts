import type { NextRequest } from "next/server";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { deleteExercise, exerciseSchema, loadExerciseAdmin, saveExercise } from "@/lib/gym/exercises-admin-server";
import { ok, parseBody, requireUuid } from "@/lib/gym/staff-route";
import { IAM } from "@/lib/iam/prefixes";

/** GET: pustaka latihan + aturan substitusi (dengan nama latihan). */
export const GET = apiHandler(async () => {
  await requireIamMenuPrefix(IAM.gymExercises);
  return ok(await loadExerciseAdmin());
}, "gym.exercises.GET");

/** POST: buat atau ubah latihan. Nomor stasiun dan kode harus unik. */
export const POST = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.gymExercises);
  const input = await parseBody(request, exerciseSchema);
  return ok(await saveExercise(input));
}, "gym.exercises.POST");

/** DELETE ?id=: hapus latihan beserta aturan substitusinya. */
export const DELETE = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.gymExercises);
  const id = requireUuid(request.nextUrl.searchParams.get("id"));
  await deleteExercise(id);
  return ok({ id });
}, "gym.exercises.DELETE");
