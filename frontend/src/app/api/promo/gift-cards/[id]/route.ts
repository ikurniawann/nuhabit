import type { NextRequest } from "next/server";
import { z } from "zod";
import { ApiError, successResponse, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { linkGiftCardToMember } from "@/lib/giftcard/giftcard-server";
import { setGiftCardActive } from "@/lib/promo/gift-cards-server";
import { requirePromoContext } from "@/lib/promo/server";

type Ctx = { params: Promise<{ id: string }> };

// EPIC-034 Fase A — satu aksi per permintaan: toggle aktif ATAU tautkan/lepas
// member (customer_id null = lepas).
const patchSchema = z.union([
  z.object({ is_active: z.boolean() }).strict(),
  z.object({ customer_id: z.string().uuid().nullable() }).strict(),
]);

export const PATCH = apiHandler(async (request: NextRequest, { params }: Ctx) => {
  const ctx = await requirePromoContext();
  const { id } = await params;
  const body = await validateBody(request, patchSchema);

  if ("customer_id" in body) {
    const linked = await linkGiftCardToMember({
      scope: { companyId: ctx.companyId, branchId: ctx.branchId },
      cardId: id,
      customerId: body.customer_id,
    });
    if (!linked) throw ApiError.notFound("Gift card atau member tidak ditemukan");
    return successResponse(
      { id, customer_id: body.customer_id },
      body.customer_id ? "Gift card ditautkan ke member" : "Tautan member dilepas"
    );
  }

  return successResponse(await setGiftCardActive(ctx, id, body.is_active), "Gift card diperbarui");
}, "promo.gift-cards.id.PATCH");
