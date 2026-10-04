import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler } from "@/lib/api/handler";
import { PROMO_REJECT_LABELS } from "@/lib/promo/promo";
import { previewPromoCode } from "@/lib/promo/promo-server";
import { findOfferByUnlockCode } from "@/lib/promo/offer-rules-server";
import { todayJakartaIso } from "@/lib/promo/offer-pos";
import { enforceRateLimit, parseJsonBody, requireDefaultVenue, requirePosSession } from "@/lib/pos/route-guards";

// EPIC-032 C1 — validasi kode untuk kasir (channel 'pos'). INDIKATIF:
// kebenaran final tetap di server saat order dibuat (422 bila keburu habis).
// Kode bisa berupa kode pembuka penawaran (data.kind = 'offer', diskonnya
// dihitung engine penawaran) atau kode campaign promo (data.kind = 'promo').
// Auth = sesi kasir POS.

const checkSchema = z.object({
  code: z.string().trim().min(3).max(40),
  subtotal: z.number().min(0).max(1_000_000_000),
  /** Baris keranjang (nilai bersih) — wajib utk kode yang dibatasi produk. */
  items: z
    .array(
      z.object({
        product_id: z.string().uuid(),
        amount: z.number().min(0).max(1_000_000_000),
      })
    )
    .max(500)
    .optional(),
  customer_id: z.string().uuid().nullable().optional(),
});

export const POST = apiHandler(async (request: NextRequest) => {
  const sessionUserId = await requirePosSession();
  enforceRateLimit(`pos-promo-check:${sessionUserId}`, 30);
  const body = await parseJsonBody(request, checkSchema);
  const venue = await requireDefaultVenue();

  const offer = await findOfferByUnlockCode({ ...venue, code: body.code, todayIsoDate: todayJakartaIso() });
  if (offer) {
    return NextResponse.json({
      success: true,
      data: { ok: true, kind: "offer", rule_id: offer.id, offer_name: offer.name, discount: 0 },
    });
  }

  const preview = await previewPromoCode({
    scope: venue,
    code: body.code,
    channel: "pos",
    subtotal: body.subtotal,
    phone: null,
    customerId: body.customer_id ?? null,
    lines: body.items?.map((item) => ({ productId: item.product_id, amount: item.amount })),
  });
  const data = preview.ok
    ? { ...preview, kind: "promo" as const }
    : { ...preview, kind: "promo" as const, label: PROMO_REJECT_LABELS[preview.reason] };
  return NextResponse.json({ success: true, data });
}, "pos/promo-check");
