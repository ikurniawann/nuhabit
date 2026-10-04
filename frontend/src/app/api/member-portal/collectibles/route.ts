import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { getMemberSession } from "@/lib/member-portal/session";
import { getMemberContext } from "@/lib/crm/rewards-server";
import {
  evaluateCollectible,
  getEntitlementSummary,
  listCollectiblesForMember,
  sortCollectibles,
} from "@/lib/crm/collectibles-server";

/**
 * EPIC-014 Task 1 — etalase koleksi di portal member.
 *
 * Sebelum ini koleksi hanya bisa diberikan admin lewat /api/crm/avatar-inventory
 * dan tidak pernah terlihat member. Endpoint ini membuka jalur baca tersebut.
 *
 * XP tidak berkurang di mana pun — hanya menentukan kelayakan.
 */
export async function GET() {
  try {
    const session = await getMemberSession();
    if (!session) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const pool = getPool();
    const member = await getMemberContext(pool, session.customerId);
    if (!member) {
      return NextResponse.json(
        { success: false, error: "Member tidak ditemukan" },
        { status: 404 }
      );
    }

    // Member tanpa profil CRM belum punya inventory; katalog tetap tampil
    // sebagai etalase supaya ia tahu apa yang bisa dikejar.
    const [rows, entitlement] = await Promise.all([
      listCollectiblesForMember(pool, member.memberProfileId),
      // Jatah tukar (Task 2): dihitung saat dibaca dari total_xp kanonik.
      getEntitlementSummary(pool, session.customerId, member.totalXp),
    ]);
    const items = sortCollectibles(
      rows.map((row) => evaluateCollectible(row, member.totalXp))
    );

    return NextResponse.json({
      success: true,
      data: {
        member: {
          name: member.name,
          total_xp: member.totalXp,
          tier_name: member.tierName,
        },
        entitlement,
        owned_count: items.filter((item) => item.owned).length,
        total_count: items.length,
        items,
      },
    });
  } catch (error) {
    console.error("Error fetching member portal collectibles:", error);
    return NextResponse.json(
      { success: false, error: "Gagal memuat koleksi" },
      { status: 500 }
    );
  }
}
