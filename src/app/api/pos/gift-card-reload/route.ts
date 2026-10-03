import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getPosSession } from "@/lib/api/auth";
import { getCrmDefaultVenue } from "@/lib/crm/server";
import { isValidGiftCardCodeFormat } from "@/lib/giftcard/giftcard";
import { reloadGiftCard } from "@/lib/giftcard/giftcard-server";
import { giftCardReloadSchema } from "@/lib/giftcard/reload-schema";
import { createPgClient } from "@/lib/pg/create-client";
import { checkRateLimit } from "@/lib/rate-limit";

// Reload gift card di kasir: kode diketik atau hasil scan QR kartu (nilai
// QR = kode kartu). Auth = sesi kasir POS; pembayaran tercatat di ledger.

const reloadSchema = giftCardReloadSchema.extend({
  code: z.string().trim().min(3).max(40),
});

export async function POST(request: NextRequest) {
  const sessionUserId = await getPosSession();
  if (!sessionUserId) {
    return NextResponse.json(
      { success: false, error: "Authentication required" },
      { status: 401 }
    );
  }
  const rate = checkRateLimit(`pos-gift-card-reload:${sessionUserId}`, 20);
  if (!rate.allowed) {
    return NextResponse.json(
      { success: false, error: "Terlalu banyak percobaan — tunggu sebentar" },
      { status: 429 }
    );
  }

  try {
    const parsed = reloadSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Validation failed", details: parsed.error.issues },
        { status: 400 }
      );
    }
    const code = parsed.data.code.toUpperCase();
    if (!isValidGiftCardCodeFormat(code)) {
      return NextResponse.json(
        { success: false, error: "Format kode gift card tidak valid" },
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

    const result = await reloadGiftCard({
      scope: { companyId: venue.companyId, branchId: venue.branchId },
      card: { code },
      amount: parsed.data.amount,
      paymentMethod: parsed.data.payment_method,
      paymentReference: parsed.data.payment_reference ?? null,
      note: parsed.data.note ?? null,
      createdBy: sessionUserId,
    });
    if (!result.ok) {
      console.warn(`[pos] gift card reload rejected: user=${sessionUserId} reason=${result.reason}`);
      return NextResponse.json({ success: false, error: result.reason }, { status: result.status });
    }
    return NextResponse.json({ success: true, data: result });
  } catch (err) {
    console.error("[pos] gift card reload error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal reload gift card" },
      { status: 500 }
    );
  }
}
