import { z } from "zod";
import { getPool, withTransaction } from "@/lib/db";
import { IAM } from "@/lib/iam/prefixes";
import {
  cancelSession,
  completeSession,
  deleteSession,
  getSession,
  publishSession,
  sessionRoster,
  updateSession,
} from "@/lib/gym/booking-server";
import { fail, ok, schedulingRoute, uuid } from "@/lib/gym/scheduling-route";
import { sessionPatchSchema } from "@/lib/gym/scheduling-schemas";

type Ctx = { params: Promise<{ id: string }> };
const sessionId = async (ctx: Ctx) => uuid.parse((await ctx.params).id);

/** GET — detail sesi + daftar peserta dan waitlist. */
export const GET = schedulingRoute(IAM.gymScheduling, "Gagal memuat sesi", async (_userId, _request: Request, ctx: Ctx) => {
  const id = await sessionId(ctx);
  const pool = getPool();
  const session = await getSession(pool, id);
  if (!session) return fail("Sesi tidak ditemukan", 404);
  return ok({ session, roster: await sessionRoster(pool, id) });
});

/** PATCH — ubah coach, area, jam, durasi, kapasitas, catatan. */
export const PATCH = schedulingRoute(IAM.gymScheduling, "Gagal mengubah sesi", async (_userId, request: Request, ctx: Ctx) => {
  const id = await sessionId(ctx);
  const input = sessionPatchSchema.parse(await request.json());
  await withTransaction((client) =>
    updateSession(client, id, {
      coachId: input.coach_id,
      area: input.area,
      startsAt: input.starts_at,
      durationMin: input.duration_min,
      capacity: input.capacity,
      notes: input.notes,
    })
  );
  return ok({ id });
});

const actionSchema = z.object({ action: z.enum(["publish", "cancel", "complete"]) });

/** POST {action} — terbitkan, batalkan (member dikabari), atau selesaikan (no-show diproses). */
export const POST = schedulingRoute(IAM.gymScheduling, "Gagal memproses sesi", async (_userId, request: Request, ctx: Ctx) => {
  const id = await sessionId(ctx);
  const { action } = actionSchema.parse(await request.json());
  const result = await withTransaction(async (client) => {
    if (action === "publish") return publishSession(client, id);
    if (action === "cancel") return cancelSession(client, id);
    return completeSession(client, id);
  });
  return ok({ id, action, ...(result ?? {}) });
});

/** DELETE — hanya sesi tanpa booking. */
export const DELETE = schedulingRoute(IAM.gymScheduling, "Gagal menghapus sesi", async (_userId, _request: Request, ctx: Ctx) => {
  const id = await sessionId(ctx);
  await withTransaction((client) => deleteSession(client, id));
  return ok({ id });
});
