import type { NextRequest } from "next/server";
import { z } from "zod";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { getPool, withTransaction } from "@/lib/db";
import {
  cancelSession,
  completeSession,
  deleteSession,
  getSession,
  publishSession,
  sessionRoster,
  updateSession,
} from "@/lib/gym/booking-server";
import { sessionPatchSchema } from "@/lib/gym/scheduling-schemas";
import { ok, parseBody, requireUuid } from "@/lib/gym/staff-route";
import { IAM } from "@/lib/iam/prefixes";

type Ctx = { params: Promise<{ id: string }> };

/** GET: detail sesi + daftar peserta dan waitlist. */
export const GET = apiHandler(async (_request: NextRequest, ctx: Ctx) => {
  await requireIamMenuPrefix(IAM.gymScheduling);
  const id = requireUuid((await ctx.params).id);
  const pool = getPool();
  const session = await getSession(pool, id);
  if (!session) throw ApiError.notFound("Sesi tidak ditemukan");
  return ok({ session, roster: await sessionRoster(pool, id) });
}, "gym.sessions.[id].GET");

/** PATCH: ubah coach, area, jam, durasi, kapasitas, catatan. */
export const PATCH = apiHandler(async (request: NextRequest, ctx: Ctx) => {
  await requireIamMenuPrefix(IAM.gymScheduling);
  const id = requireUuid((await ctx.params).id);
  const input = await parseBody(request, sessionPatchSchema);
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
}, "gym.sessions.[id].PATCH");

const actionSchema = z.object({ action: z.enum(["publish", "cancel", "complete"]) });

/** POST {action}: terbitkan, batalkan (member dikabari), atau selesaikan (no-show diproses). */
export const POST = apiHandler(async (request: NextRequest, ctx: Ctx) => {
  await requireIamMenuPrefix(IAM.gymScheduling);
  const id = requireUuid((await ctx.params).id);
  const { action } = await parseBody(request, actionSchema);
  const result = await withTransaction(async (client) => {
    if (action === "publish") return publishSession(client, id);
    if (action === "cancel") return cancelSession(client, id);
    return completeSession(client, id);
  });
  return ok({ id, action, ...(result ?? {}) });
}, "gym.sessions.[id].POST");

/** DELETE: hanya sesi tanpa booking. */
export const DELETE = apiHandler(async (_request: NextRequest, ctx: Ctx) => {
  await requireIamMenuPrefix(IAM.gymScheduling);
  const id = requireUuid((await ctx.params).id);
  await withTransaction((client) => deleteSession(client, id));
  return ok({ id });
}, "gym.sessions.[id].DELETE");
