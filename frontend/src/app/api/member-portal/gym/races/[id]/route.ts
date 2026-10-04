import { z } from "zod";
import { DIVISIONS } from "@/lib/gym/hyrox";
import { updateMemberRace } from "@/lib/gym/races-server";
import { memberError, memberJson, withMemberSession } from "@/lib/member-portal/route";

type Ctx = { params: Promise<{ id: string }> };

const updateSchema = z.object({
  division: z.enum(DIVISIONS).optional(),
  goal_sec: z.number().int().positive().max(6 * 3600).nullable().optional(),
  result_sec: z.number().int().positive().max(6 * 3600).optional(),
  cancel: z.boolean().optional(),
});

/** PATCH — ubah target/divisi, catat hasil race, atau batalkan target race (id = entri race member). */
export const PATCH = withMemberSession("Gagal memperbarui race", async (customerId, request: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) return memberError("ID tidak valid");
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return memberError("Data race tidak valid");
  const outcome = await updateMemberRace(customerId, id, {
    division: parsed.data.division,
    goalSec: parsed.data.goal_sec,
    resultSec: parsed.data.result_sec,
    cancel: parsed.data.cancel,
  });
  if (!outcome.ok) return memberError(outcome.error, outcome.status);
  return memberJson({ id });
});
