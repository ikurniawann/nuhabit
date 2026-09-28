import { cache } from "react";
import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import {
  ARK_COIN_DISABLED_MESSAGE,
  ARK_COIN_SETTING_KEY,
  DEFAULT_LOYALTY_FEATURES,
  XP_SETTING_KEY,
  parseLoyaltyFeatures,
  type LoyaltyFeatures,
} from "./loyalty-features";

/**
 * Flag ARK Coin & XP dari crm.crm_settings. Di-cache per request (react
 * cache) karena dipanggil dari layout, menu, dan API dalam satu render.
 * Gagal baca (skema CRM belum ada, DB down) → default AKTIF, supaya instance
 * lama tidak tiba-tiba kehilangan menu.
 */
export const getLoyaltyFeatures = cache(async (): Promise<LoyaltyFeatures> => {
  try {
    const rows = await query<{ key: string; value: unknown }>(
      `SELECT key, value FROM crm.crm_settings WHERE key = ANY($1::text[])`,
      [[ARK_COIN_SETTING_KEY, XP_SETTING_KEY]]
    );
    return parseLoyaltyFeatures(rows);
  } catch (error) {
    console.error("[loyalty-features] gagal membaca crm_settings, pakai default aktif:", error);
    return DEFAULT_LOYALTY_FEATURES;
  }
});

/**
 * Pengaman API: tolak transaksi yang memakai saldo ARK Coin saat fiturnya
 * dimatikan. Menu & metode bayar sudah disembunyikan, tapi klien lama/tab
 * yang masih terbuka tetap bisa mengirim request. Kembalikan null bila boleh.
 */
export async function rejectIfArkCoinDisabled(usesArkCoin: boolean): Promise<NextResponse | null> {
  if (!usesArkCoin) return null;
  const { arkCoin } = await getLoyaltyFeatures();
  if (arkCoin) return null;
  return NextResponse.json(
    { success: false, error: ARK_COIN_DISABLED_MESSAGE, code: "ARK_COIN_DISABLED" },
    { status: 409 }
  );
}
