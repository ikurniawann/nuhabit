import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { deletePackage, setPackageStatus } from "@/lib/gym/credit-packages-server";
import { ok, parseBody, requireUuid } from "@/lib/gym/staff-route";
import { IAM } from "@/lib/iam/prefixes";

type Ctx = { params: Promise<{ id: string }> };

const statusSchema = z.object({ status: z.enum(["active", "archived"]) });

/** PATCH { status }: arsipkan (berhenti dijual) atau aktifkan lagi. */
export const PATCH = apiHandler(async (request: NextRequest, ctx: Ctx) => {
  await requireIamMenuPrefix(IAM.gymPackages);
  const id = requireUuid((await ctx.params).id);
  const { status } = await parseBody(request, statusSchema, "issue");
  return ok(await setPackageStatus(id, status));
}, "gym.packages.[id].PATCH");

/** DELETE: hapus paket yang belum pernah dibeli; paket berriwayat hanya bisa diarsipkan. */
export const DELETE = apiHandler(async (_request: NextRequest, ctx: Ctx) => {
  await requireIamMenuPrefix(IAM.gymPackages);
  const id = requireUuid((await ctx.params).id);
  await deletePackage(id);
  return ok({ id, deleted: true });
}, "gym.packages.[id].DELETE");
