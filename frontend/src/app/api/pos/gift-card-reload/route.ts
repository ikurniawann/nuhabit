import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ApiError } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { isValidGiftCardCodeFormat } from "@/lib/giftcard/giftcard";
import { reloadGiftCard } from "@/lib/giftcard/giftcard-server";
import { giftCardReloadSchema } from "@/lib/giftcard/reload-schema";
import { enforceRateLimit, parseJsonBody, requireDefaultVenue, requirePosSession } from "@/lib/pos/route-guards";

// Reload gift card di kasir: kode diketik atau hasil scan QR kartu (nilai
// QR = kode kartu). Auth = sesi kasir POS; pembayaran tercatat di ledger.

const reloadSchema = giftCardReloadSchema.extend({
  code: z.string().trim().min(3).max(40),
});

export const POST = apiHandler(async (request: NextRequest) => {
  const sessionUserId = await requirePosSession();
  enforceRateLimit(`pos-gift-card-reload:${sessionUserId}`, 20);
  const body = await parseJsonBody(request, reloadSchema);
  const code = body.code.toUpperCase();
  if (!isValidGiftCardCodeFormat(code)) throw ApiError.badRequest("Format kode gift card tidak valid");
  const venue = await requireDefaultVenue();

  const result = await reloadGiftCard({
    scope: venue,
    card: { code },
    amount: body.amount,
    paymentMethod: body.payment_method,
    paymentReference: body.payment_reference ?? null,
    note: body.note ?? null,
    createdBy: sessionUserId,
  });
  if (!result.ok) {
    console.warn(`[pos] gift card reload rejected: user=${sessionUserId} reason=${result.reason}`);
    throw new ApiError(result.status, result.reason);
  }
  return NextResponse.json({ success: true, data: result });
}, "pos/gift-card-reload");
