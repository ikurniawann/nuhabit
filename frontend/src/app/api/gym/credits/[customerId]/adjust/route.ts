import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { withTransaction } from "@/lib/db";
import { adjustCredits } from "@/lib/gym/credits-server";
import { ok, parseBody, requireUuid } from "@/lib/gym/staff-route";
import { IAM } from "@/lib/iam/prefixes";

type Ctx = { params: Promise<{ customerId: string }> };

const schema = z.object({
  amount: z.number().int("Jumlah harus bilangan bulat"),
  reason: z.string().trim().min(3, "Alasan penyesuaian wajib diisi").max(500),
});

/** POST { amount, reason }: penyesuaian manual. Plus menjadi lot baru dengan masa berlaku default. */
export const POST = apiHandler(async (request: NextRequest, ctx: Ctx) => {
  const user = await requireIamMenuPrefix(IAM.gymCredits);
  const customerId = requireUuid((await ctx.params).customerId);
  const body = await parseBody(request, schema, "issue");
  const result = await withTransaction((client) =>
    adjustCredits(client, { customerId, amount: body.amount, reason: body.reason, actorId: user.id })
  );
  return ok(result);
}, "gym.credits.adjust.POST");
