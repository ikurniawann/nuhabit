import { z } from "zod";
import { startWorkoutSession } from "@/lib/gym/training-server";
import { memberError, memberJson, withMemberSession } from "@/lib/member-portal/route";

type Ctx = { params: Promise<{ id: string }> };

/** POST — mulai sesi baru untuk workout milik member. */
export const POST = withMemberSession("Gagal memulai workout", async (customerId, _request: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) return memberError("ID tidak valid");
  const session = await startWorkoutSession(customerId, id);
  if (!session) return memberError("Workout tidak ditemukan", 404);
  return memberJson(session);
});
