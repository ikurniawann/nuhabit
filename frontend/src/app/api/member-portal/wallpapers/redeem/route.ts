import { NextResponse } from "next/server";
import { withTransaction } from "@/lib/db";
import { getMemberSession } from "@/lib/member-portal/session";
import { getMemberContext } from "@/lib/crm/rewards-server";
import { checkWallpaperEligibility, getEntitlementSummary } from "@/lib/crm/collectibles-server";

/**
 * Redeem wallpaper memakai jatah tukar (EPIC-014 Task 5) — pola persis redeem
 * avatar: transaksi + FOR UPDATE, evaluasi ulang di dalam transaksi, guard
 * stok di SQL, UNIQUE menangkap balapan.
 */
export async function POST(request: Request) {
  try {
    const session = await getMemberSession();
    if (!session) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    const body = (await request.json().catch(() => ({}))) as { wallpaper_id?: unknown };
    const wallpaperId = typeof body.wallpaper_id === "string" ? body.wallpaper_id : "";
    if (!/^[0-9a-f-]{36}$/i.test(wallpaperId)) {
      return NextResponse.json({ success: false, error: "Wallpaper tidak valid" }, { status: 400 });
    }

    const result = await withTransaction(async (client) => {
      const { rows: custRows } = await client.query(
        `SELECT id, total_xp::int AS total_xp FROM pos.pos_customers WHERE id = $1 FOR UPDATE`,
        [session.customerId]
      );
      if (!custRows[0]) return { status: 404 as const, error: "Member tidak ditemukan" };
      const totalXp = Number(custRows[0].total_xp ?? 0);

      const member = await getMemberContext(client, session.customerId);
      if (!member?.memberProfileId) {
        return {
          status: 409 as const,
          error: "Profil loyalty belum aktif — lakukan satu transaksi ARK Coin dulu di kasir.",
        };
      }

      const { rows: lockRows } = await client.query(
        `SELECT id FROM crm.crm_collectible_wallpapers WHERE id = $1 FOR UPDATE`,
        [wallpaperId]
      );
      if (!lockRows[0]) return { status: 404 as const, error: "Wallpaper tidak ditemukan" };

      const { rows: ownedRows } = await client.query(
        `SELECT id FROM crm.crm_member_wallpaper_inventory WHERE member_id = $1 AND wallpaper_id = $2`,
        [member.memberProfileId, wallpaperId]
      );
      if (ownedRows[0]) return { status: 409 as const, error: "Wallpaper ini sudah kamu miliki" };

      const summary = await getEntitlementSummary(client, session.customerId, totalXp);
      if (summary.remaining <= 0) {
        return { status: 409 as const, error: "Jatah tukar kamu sudah habis — kumpulkan XP lagi." };
      }

      const eligibility = await checkWallpaperEligibility(client, wallpaperId, session.customerId);
      if (!eligibility.allowed) {
        return { status: 409 as const, error: eligibility.reason ?? "Belum memenuhi syarat" };
      }

      const stockUpdate = await client.query(
        `UPDATE crm.crm_collectible_wallpapers
            SET stock_redeemed = COALESCE(stock_redeemed, 0) + 1
          WHERE id = $1
            AND (stock_total IS NULL OR COALESCE(stock_redeemed, 0) < stock_total)`,
        [wallpaperId]
      );
      if (stockUpdate.rowCount === 0) return { status: 409 as const, error: "Stok habis" };

      await client.query(
        `INSERT INTO crm.crm_member_entitlements (customer_id, member_id, asset_type, asset_id)
         VALUES ($1, $2, 'wallpaper', $3)`,
        [session.customerId, member.memberProfileId, wallpaperId]
      );
      await client.query(
        `INSERT INTO crm.crm_member_wallpaper_inventory (member_id, wallpaper_id)
         VALUES ($1, $2)`,
        [member.memberProfileId, wallpaperId]
      );

      const after = await getEntitlementSummary(client, session.customerId, totalXp);
      return { status: 200 as const, entitlement: after };
    });

    if (result.status !== 200) {
      return NextResponse.json({ success: false, error: result.error }, { status: result.status });
    }
    return NextResponse.json({
      success: true,
      message: "Wallpaper berhasil ditukar!",
      data: { entitlement: result.entitlement },
    });
  } catch (error) {
    if (error instanceof Error && "code" in error && (error as { code?: string }).code === "23505") {
      return NextResponse.json({ success: false, error: "Wallpaper ini sudah kamu miliki" }, { status: 409 });
    }
    console.error("Error redeeming wallpaper:", error);
    return NextResponse.json({ success: false, error: "Penukaran gagal. Coba lagi." }, { status: 500 });
  }
}
