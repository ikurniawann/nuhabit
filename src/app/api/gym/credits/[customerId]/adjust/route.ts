import { z } from "zod";
import { withTransaction } from "@/lib/db";
import { gymAdminRoute, ok, uuidParam } from "@/lib/gym/credits-admin-route";
import { adjustCredits } from "@/lib/gym/credits-server";
import { IAM } from "@/lib/iam/prefixes";

type Ctx = { params: Promise<{ customerId: string }> };

const schema = z.object({
  amount: z.number().int("Jumlah harus bilangan bulat"),
  reason: z.string().trim().min(3, "Alasan penyesuaian wajib diisi").max(500),
});

/** POST { amount, reason } — penyesuaian manual. Plus menjadi lot baru dengan masa berlaku default. */
export const POST = gymAdminRoute(IAM.gymCredits, "Gagal menyesuaikan kredit", async (user, request: Request, ctx: Ctx) => {
  const customerId = uuidParam.parse((await ctx.params).customerId);
  const body = schema.parse(await request.json());
  const result = await withTransaction((client) =>
    adjustCredits(client, { customerId, amount: body.amount, reason: body.reason, actorId: user.id })
  );
  return ok(result);
});
