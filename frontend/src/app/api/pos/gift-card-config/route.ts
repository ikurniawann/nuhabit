import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { loadGiftCardConfig } from "@/lib/giftcard/giftcard-server";
import { requirePosSession } from "@/lib/pos/route-guards";

// EPIC-034 Fase B — nominal preset & aturan nominal bebas untuk kasir.
// BACA SAJA: kasir tidak boleh mengubah konfigurasi (itu hak pengelola Promo
// lewat /api/promo/gift-card-config). Auth = sesi kasir POS, bukan peran
// dashboard — kasir memang perlu angka ini untuk menjual gift card.

export const GET = apiHandler(async () => {
  await requirePosSession();
  const config = await loadGiftCardConfig();
  // expiry_months sengaja tidak dikirim: kasir tidak menentukan masa
  // berlaku, server yang menghitung saat kartu terbit.
  return NextResponse.json({
    success: true,
    data: { presets: config.presets, allow_custom: config.allow_custom },
  });
}, "pos/gift-card-config");
