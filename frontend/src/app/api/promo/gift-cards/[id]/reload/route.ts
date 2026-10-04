import type { NextRequest } from "next/server";
import { ApiError, successResponse, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { reloadGiftCard } from "@/lib/giftcard/giftcard-server";
import { giftCardReloadSchema } from "@/lib/giftcard/reload-schema";
import { requirePromoContext } from "@/lib/promo/server";

type Ctx = { params: Promise<{ id: string }> };

// Reload (top up) saldo gift card dari dashboard. Pembayaran (metode +
// referensi) tersimpan di baris ledger `isi` ber-context `reload`.
export const POST = apiHandler(async (request: NextRequest, { params }: Ctx) => {
  const ctx = await requirePromoContext();
  const { id } = await params;
  const body = await validateBody(request, giftCardReloadSchema);
  const result = await reloadGiftCard({
    scope: { companyId: ctx.companyId, branchId: ctx.branchId },
    card: { id },
    amount: body.amount,
    paymentMethod: body.payment_method,
    paymentReference: body.payment_reference ?? null,
    note: body.note ?? null,
    createdBy: ctx.user.id,
  });
  if (!result.ok) throw new ApiError(result.status, result.reason);
  return successResponse(result, "Saldo gift card bertambah");
}, "promo.gift-cards.reload.POST");
