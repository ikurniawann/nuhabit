import type { NextRequest } from "next/server";
import { z } from "zod";
import { ApiError, successResponse, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { adjustGiftCardBalance } from "@/lib/giftcard/giftcard-server";
import { requirePromoContext } from "@/lib/promo/server";

type Ctx = { params: Promise<{ id: string }> };

// EPIC-034 Fase C — koreksi saldo manual ber-audit (keputusan owner 27 Jul).
// Order yang sudah `completed` tetap TIDAK bisa di-void (sama seperti cash /
// ark_coin), jadi kasus salah input di lapangan diperbaiki di sini: alasan
// WAJIB diisi dan tersimpan di ledger bersama identitas pelakunya.

const adjustSchema = z.object({
  // Bertanda: positif mengembalikan saldo, negatif menarik saldo
  delta: z
    .number()
    .refine((v) => Number.isFinite(v) && v !== 0, "Nominal koreksi tidak boleh 0")
    .refine((v) => Math.abs(v) <= 100_000_000, "Nominal koreksi terlalu besar"),
  reason: z.string().trim().min(5).max(300),
});

export const POST = apiHandler(async (request: NextRequest, { params }: Ctx) => {
  const ctx = await requirePromoContext();
  const { id } = await params;
  const body = await validateBody(request, adjustSchema);
  const result = await adjustGiftCardBalance({
    scope: { companyId: ctx.companyId, branchId: ctx.branchId },
    cardId: id,
    delta: body.delta,
    reason: body.reason,
    createdBy: ctx.user.id,
  });
  if (!result.ok) throw new ApiError(result.status, result.reason);
  // Jejak audit di log server selain baris ledger
  console.warn(`[giftcard] koreksi saldo: card=${id} delta=${body.delta} by=${ctx.user.id}`);
  return successResponse(result, "Saldo gift card dikoreksi");
}, "promo.gift-cards.adjust.POST");
