import { NextResponse } from "next/server";
import { ApiError, getPosSession } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { getLoyaltyFeatures } from "@/lib/crm/loyalty-features-server";

/**
 * Flag ARK Coin & XP untuk UI (kasir, halaman member). Cukup sesi login —
 * kasir tidak punya hak buka pengaturan CRM, tapi perlu tahu fitur mana
 * yang ditampilkan. Mengubah flag tetap lewat PUT /api/crm/settings.
 */
export const dynamic = "force-dynamic";

export const GET = apiHandler(async () => {
  if (!(await getPosSession())) throw ApiError.unauthorized();
  return NextResponse.json({ success: true, data: await getLoyaltyFeatures() });
}, "crm.loyalty-features.GET");
