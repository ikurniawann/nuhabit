import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { rejectIfArkCoinDisabled } from "@/lib/crm/loyalty-features-server";
import { FRONT_DESK_METHODS } from "@/lib/gym/credit-purchases-server";
import { sellCreditPackage } from "@/lib/gym/credits-admin-server";
import { ok, parseBody, requireUuid } from "@/lib/gym/staff-route";
import { IAM } from "@/lib/iam/prefixes";

type Ctx = { params: Promise<{ customerId: string }> };

const schema = z.object({
  package_id: z.string().uuid("Pilih paket"),
  payment_method: z.enum(FRONT_DESK_METHODS),
  discount_idr: z.number().min(0).default(0),
  branch_id: z.string().uuid().nullable().default(null),
  note: z.string().trim().max(300).optional().nullable(),
});

/** POST: jual paket di front desk; pembelian langsung lunas dan kredit langsung terbit. */
export const POST = apiHandler(async (request: NextRequest, ctx: Ctx) => {
  const user = await requireIamMenuPrefix(IAM.gymCredits);
  const customerId = requireUuid((await ctx.params).customerId);
  const body = await parseBody(request, schema, "issue");
  const blocked = await rejectIfArkCoinDisabled(body.payment_method === "ark_coin");
  if (blocked) return blocked;
  const purchase = await sellCreditPackage({
    customerId,
    packageId: body.package_id,
    paymentMethod: body.payment_method,
    discountIdr: body.discount_idr,
    branchId: body.branch_id,
    note: body.note,
    cashierId: user.id,
  });
  return ok(purchase);
}, "gym.credits.sell.POST");
