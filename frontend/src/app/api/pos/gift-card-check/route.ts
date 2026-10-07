import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ApiError } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { previewGiftCardForPos } from "@/lib/giftcard/giftcard-server";
import { isValidGiftCardCodeFormat } from "@/lib/giftcard/giftcard";
import { enforceRateLimit, parseJsonBody, requireDefaultVenue, requirePosSession } from "@/lib/pos/route-guards";

// EPIC-034 Fase C — cek saldo gift card untuk kasir sebelum membayar.
// INDIKATIF: kebenaran final tetap ditegakkan saat debit ber-lock di rute
// order (pola promo-check EPIC-032). Auth = sesi kasir POS.
//
// Kode gift card = uang bagi pemegangnya, jadi endpoint ini dibatasi ketat:
// rate limit per kasir, hanya kode yang diketik PERSIS yang dicari (tanpa
// pencarian sebagian/daftar), dan balasan gagal tidak membedakan "kode tidak
// ada" dari "kode salah format" lebih jauh dari yang perlu.

const checkSchema = z.object({
  code: z.string().trim().min(3).max(40),
  total: z.number().min(0).max(1_000_000_000),
});

export const POST = apiHandler(async (request: NextRequest) => {
  const sessionUserId = await requirePosSession();
  // Plafon lebih ketat dari promo-check: menebak kode bearer = menebak uang
  enforceRateLimit(`pos-gift-card-check:${sessionUserId}`, 20);
  const body = await parseJsonBody(request, checkSchema);
  const code = body.code.trim().toUpperCase();
  if (!isValidGiftCardCodeFormat(code)) throw ApiError.badRequest("Format kode gift card tidak valid");
  const venue = await requireDefaultVenue();

  const preview = await previewGiftCardForPos({ scope: venue, code, total: body.total });
  if (!preview.ok) {
    // Percobaan gagal tetap dicatat — pola audit tab/gift card (uang).
    console.warn(`[pos] gift card check rejected: user=${sessionUserId} reason=${preview.reason}`);
  }
  return NextResponse.json({ success: true, data: preview });
}, "pos/gift-card-check");
