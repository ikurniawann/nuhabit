import { NextResponse } from "next/server";
import { getPosSession } from "@/lib/api/auth";
import { getLoyaltyFeatures } from "@/lib/crm/loyalty-features-server";

/**
 * Flag ARK Coin & XP untuk UI (kasir, halaman member). Cukup sesi login —
 * kasir tidak punya hak buka pengaturan CRM, tapi perlu tahu fitur mana
 * yang ditampilkan. Mengubah flag tetap lewat PUT /api/crm/settings.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const sessionUserId = await getPosSession();
  if (!sessionUserId) {
    return NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 });
  }
  return NextResponse.json({ success: true, data: await getLoyaltyFeatures() });
}
