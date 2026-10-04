import { z } from "zod";
import { actOnWorkoutSession, loadMemberSession } from "@/lib/gym/training-server";
import { memberError, memberJson, withMemberSession } from "@/lib/member-portal/route";

type Ctx = { params: Promise<{ id: string }> };

const blockResult = z.object({
  order: z.number().int().min(1),
  duration_sec: z.number().min(0).max(24 * 3600),
});

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("pause") }),
  z.object({ action: z.literal("resume") }),
  z.object({ action: z.literal("record"), ...blockResult.shape }),
  z.object({
    action: z.literal("complete"),
    block_results: z.array(blockResult).max(64).default([]),
    partial: z.boolean().default(false),
  }),
]);

const isUuid = (id: string) => z.string().uuid().safeParse(id).success;

/** GET — status sesi workout (untuk melanjutkan timer setelah aplikasi dibuka ulang). */
export const GET = withMemberSession("Gagal memuat sesi workout", async (customerId, _request: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  if (!isUuid(id)) return memberError("ID tidak valid");
  const session = await loadMemberSession(customerId, id);
  if (!session) return memberError("Sesi tidak ditemukan", 404);
  return memberJson(session);
});

/**
 * POST — aksi sesi: pause | resume | record (satu blok) | complete (dengan
 * hasil blok; tanpa semua blok → partial).
 */
export const POST = withMemberSession("Gagal memperbarui sesi workout", async (customerId, request: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  if (!isUuid(id)) return memberError("ID tidak valid");
  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return memberError("Aksi sesi tidak valid");
  const input = parsed.data;
  const outcome = await actOnWorkoutSession(
    customerId,
    id,
    input.action === "record"
      ? { action: "record", order: input.order, durationSec: input.duration_sec }
      : input.action === "complete"
        ? {
            action: "complete",
            partial: input.partial,
            blockResults: input.block_results.map((r) => ({ order: r.order, durationSec: r.duration_sec })),
          }
        : input
  );
  if (!outcome.ok) return memberError(outcome.error, outcome.status);
  return memberJson(outcome.session);
});
