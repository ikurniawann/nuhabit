import type { NextRequest } from "next/server";
import { z } from "zod";
import { successResponse, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { MAX_GIFT_CARD_VALUE } from "@/lib/giftcard/giftcard";
import { loadGiftCardConfig, saveGiftCardConfig } from "@/lib/giftcard/giftcard-server";
import { requirePromoContext } from "@/lib/promo/server";

// EPIC-034 Fase B — konfigurasi nominal & masa berlaku gift card (keputusan
// owner #4: configurable, bukan hardcode). Guard = pengelola Promo, sama dgn
// tab Gift Card yang menampungnya.

const putSchema = z.object({
  presets: z
    .array(z.number().int().positive().max(MAX_GIFT_CARD_VALUE))
    .min(1)
    .max(12)
    .optional(),
  allow_custom: z.boolean().optional(),
  expiry_months: z.number().int().min(1).max(120).nullable().optional(),
});

export const GET = apiHandler(async () => {
  await requirePromoContext();
  return successResponse(await loadGiftCardConfig());
}, "promo.gift-card-config.GET");

export const PUT = apiHandler(async (request: NextRequest) => {
  await requirePromoContext();
  const body = await validateBody(request, putSchema);
  return successResponse(await saveGiftCardConfig(body), "Konfigurasi gift card tersimpan");
}, "promo.gift-card-config.PUT");
