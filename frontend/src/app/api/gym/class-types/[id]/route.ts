import type { NextRequest } from "next/server";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { archiveClassType, updateClassType } from "@/lib/gym/catalog-server";
import { classTypeSchema } from "@/lib/gym/scheduling-schemas";
import { ok, parseBody, requireUuid } from "@/lib/gym/staff-route";
import { IAM } from "@/lib/iam/prefixes";

type Ctx = { params: Promise<{ id: string }> };

/** PATCH: ubah template. Sesi yang sudah dibuat tidak ikut berubah. */
export const PATCH = apiHandler(async (request: NextRequest, ctx: Ctx) => {
  await requireIamMenuPrefix(IAM.gymScheduling);
  const id = requireUuid((await ctx.params).id);
  const input = await parseBody(request, classTypeSchema.partial());
  return ok(await updateClassType(id, input));
}, "gym.class-types.[id].PATCH");

/** DELETE: arsipkan (sesi lama tetap merujuk ke template ini). */
export const DELETE = apiHandler(async (_request: NextRequest, ctx: Ctx) => {
  await requireIamMenuPrefix(IAM.gymScheduling);
  const id = requireUuid((await ctx.params).id);
  await archiveClassType(id);
  return ok({ id });
}, "gym.class-types.[id].DELETE");
