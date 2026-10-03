import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getPosSession } from "@/lib/api/auth";
import { getCrmDefaultVenue } from "@/lib/crm/server";
import { createPgClient } from "@/lib/pg/create-client";
import { PROMO_REJECT_LABELS } from "@/lib/promo/promo";
import { previewPromoCode } from "@/lib/promo/promo-server";
import { findOfferByUnlockCode } from "@/lib/promo/offer-rules-server";
import { todayJakartaIso } from "@/lib/promo/offer-pos";
import { checkRateLimit } from "@/lib/rate-limit";

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

export async function POST(request: NextRequest) {
  const sessionUserId = await getPosSession();
  if (!sessionUserId) {
    return NextResponse.json(
      { success: false, error: "Authentication required" },
      { status: 401 }
    );
  }
  const rate = checkRateLimit(`pos-promo-check:${sessionUserId}`, 30);
  if (!rate.allowed) {
    return NextResponse.json(
      { success: false, error: "Terlalu banyak percobaan — tunggu sebentar" },
      { status: 429 }
    );
  }

  try {
    const parsed = checkSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Validation failed" },
        { status: 400 }
      );
    }
    const venue = await getCrmDefaultVenue(createPgClient());
    if (!venue.companyId || !venue.branchId) {
      return NextResponse.json(
        { success: false, error: "Venue belum dikonfigurasi" },
        { status: 400 }
      );
    }

    const offer = await findOfferByUnlockCode({
      companyId: venue.companyId,
      branchId: venue.branchId,
      code: parsed.data.code,
      todayIsoDate: todayJakartaIso(),
    });
    if (offer) {
      return NextResponse.json({
        success: true,
        data: { ok: true, kind: "offer", rule_id: offer.id, offer_name: offer.name, discount: 0 },
      });
    }

    const preview = await previewPromoCode({
      scope: { companyId: venue.companyId, branchId: venue.branchId },
      code: parsed.data.code,
      channel: "pos",
      subtotal: parsed.data.subtotal,
      phone: null,
      customerId: parsed.data.customer_id ?? null,
      lines: parsed.data.items?.map((item) => ({
        productId: item.product_id,
        amount: item.amount,
      })),
    });
    const data = preview.ok
      ? { ...preview, kind: "promo" as const }
      : { ...preview, kind: "promo" as const, label: PROMO_REJECT_LABELS[preview.reason] };
    return NextResponse.json({ success: true, data });
  } catch (err) {
    console.error("[pos] promo check error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal memeriksa kode promo" },
      { status: 500 }
    );
  }
}
