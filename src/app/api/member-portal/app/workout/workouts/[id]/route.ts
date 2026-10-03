import { z } from "zod";
import { loadMemberWorkout, replaceMemberWorkoutBlock } from "@/lib/member-app/workout-server";
import { memberError, memberJson, withMemberSession } from "@/lib/member-portal/route";

type Ctx = { params: Promise<{ id: string }> };

const isUuid = (id: string) => z.string().uuid().safeParse(id).success;

const replaceSchema = z.object({
  order: z.number().int().min(1),
  exercise_id: z.string().uuid(),
});

/** GET — satu workout milik member (pratinjau + layar workout aktif). */
export const GET = withMemberSession("Gagal memuat workout", async (customerId, _request: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  if (!isUuid(id)) return memberError("ID tidak valid");
  const workout = await loadMemberWorkout(customerId, id);
  if (!workout) return memberError("Workout tidak ditemukan", 404);
  return memberJson(workout);
});

/** PATCH — ganti latihan satu blok stasiun dengan penggantinya. */
export const PATCH = withMemberSession("Gagal mengganti latihan", async (customerId, request: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  if (!isUuid(id)) return memberError("ID tidak valid");
  const parsed = replaceSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return memberError("Pilihan latihan tidak valid");
  const outcome = await replaceMemberWorkoutBlock(customerId, id, parsed.data.order, parsed.data.exercise_id);
  if (!outcome.ok) return memberError(outcome.error, outcome.status);
  return memberJson(outcome.workout);
});
