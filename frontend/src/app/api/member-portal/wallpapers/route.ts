import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { getMemberSession } from "@/lib/member-portal/session";
import { getMemberContext } from "@/lib/crm/rewards-server";
import {
  evaluateCollectible,
  getEntitlementSummary,
  listWallpapersForMember,
  sortCollectibles,
} from "@/lib/crm/collectibles-server";

/** Etalase wallpaper member (EPIC-014 Task 5) — alur jatah yang sama dengan avatar. */
export async function GET() {
  try {
    const session = await getMemberSession();
    if (!session) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

    const pool = getPool();
    const member = await getMemberContext(pool, session.customerId);
    if (!member) {
      return NextResponse.json({ success: false, error: "Member tidak ditemukan" }, { status: 404 });
    }

    const [rows, entitlement] = await Promise.all([
      listWallpapersForMember(pool, member.memberProfileId),
      getEntitlementSummary(pool, session.customerId, member.totalXp),
    ]);
    const items = sortCollectibles(rows.map((row) => evaluateCollectible(row, member.totalXp)));

    return NextResponse.json({
      success: true,
      data: {
        entitlement,
        owned_count: items.filter((item) => item.owned).length,
        items,
      },
    });
  } catch (error) {
    console.error("Error fetching member wallpapers:", error);
    return NextResponse.json({ success: false, error: "Gagal memuat wallpaper" }, { status: 500 });
  }
}
