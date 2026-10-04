import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { createPgClient } from "@/lib/pg/create-client";
import { loadPosReceiptSettingsRows, normalizeReceiptSettings } from "@/lib/pos/receipt-settings";
import { requirePosSession } from "@/lib/pos/route-guards";

/**
 * GET /api/pos/receipt-settings — baris konfigurasi struk aktif untuk kasir
 * (EPIC-040). Read-only; resolusi scope dilakukan klien dari warehouse item
 * keranjang. Guard cukup sesi POS — isinya bukan rahasia (tercetak di struk),
 * penulisan tetap lewat /api/settings/receipt yang ber-guard settings.business.
 */
export const GET = apiHandler(async () => {
  await requirePosSession();
  const rows = await loadPosReceiptSettingsRows(createPgClient());
  return NextResponse.json({ success: true, data: rows.map((row) => normalizeReceiptSettings(row)) });
}, "pos/receipt-settings");
