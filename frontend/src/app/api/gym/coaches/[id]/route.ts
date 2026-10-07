import type { NextRequest } from "next/server";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { updateCoach } from "@/lib/gym/catalog-server";
import { coachSchema } from "@/lib/gym/scheduling-schemas";
import { ok, parseInput, requireUuid } from "@/lib/gym/staff-route";
import { IAM } from "@/lib/iam/prefixes";

type Ctx = { params: Promise<{ id: string }> };

/** PATCH: ubah profil atau nonaktifkan coach. Kolom yang tidak dikirim tetap. */
export const PATCH = apiHandler(async (request: NextRequest, ctx: Ctx) => {
  await requireIamMenuPrefix(IAM.gymScheduling);
  const id = requireUuid((await ctx.params).id);
  const body: unknown = await request.json().catch(() => undefined);
  const input = parseInput(coachSchema.partial(), body);
  const sent = (key: string) => typeof body === "object" && body !== null && Object.hasOwn(body, key);
  return ok(await updateCoach(id, input, { photoUrl: sent("photo_url"), branchId: sent("branch_id") }));
}, "gym.coaches.[id].PATCH");
