import { z } from "zod";
import { rejectIfArkCoinDisabled } from "@/lib/crm/loyalty-features-server";
import { withTransaction } from "@/lib/db";
import { gymAdminRoute, ok, uuidParam } from "@/lib/gym/credits-admin-route";
import {
  createCreditPurchase,
  FRONT_DESK_METHODS,
  markCreditPurchasePaid,
  payCreditPurchaseWithArk,
} from "@/lib/gym/credit-purchases-server";
import { IAM } from "@/lib/iam/prefixes";

type Ctx = { params: Promise<{ customerId: string }> };

const schema = z.object({
  package_id: z.string().uuid("Pilih paket"),
  payment_method: z.enum(FRONT_DESK_METHODS),
  discount_idr: z.number().min(0).default(0),
  branch_id: z.string().uuid().nullable().default(null),
  note: z.string().trim().max(300).optional().nullable(),
});

/**
 * POST — jual paket di front desk. Uang diterima di kasir (atau dipotong
 * dari saldo ARK Coin), jadi pembelian langsung lunas dan kredit langsung terbit.
 */
export const POST = gymAdminRoute(IAM.gymCredits, "Gagal menjual paket", async (user, request: Request, ctx: Ctx) => {
  const customerId = uuidParam.parse((await ctx.params).customerId);
  const body = schema.parse(await request.json());
  const blocked = await rejectIfArkCoinDisabled(body.payment_method === "ark_coin");
  if (blocked) return blocked;
  const result = await withTransaction(async (client) => {
    const purchase = await createCreditPurchase(client, {
      customerId,
      packageId: body.package_id,
      channel: "front_desk",
      paymentMethod: body.payment_method,
      // Komplimen = diskon penuh (dibatasi harga paket oleh purchaseTotal).
      discountIdr: body.payment_method === "complimentary" ? Number.MAX_SAFE_INTEGER : body.discount_idr,
      branchId: body.branch_id,
      note: body.note,
      createdBy: user.id,
    });
    return body.payment_method === "ark_coin"
      ? payCreditPurchaseWithArk(client, purchase, user.id)
      : markCreditPurchasePaid(client, purchase.id, { provider: "front_desk", cashier_id: user.id });
  });
  return ok(result.purchase);
});
