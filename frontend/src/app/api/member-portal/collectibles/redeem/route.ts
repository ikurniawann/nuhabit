import { NextResponse } from "next/server";
import { withTransaction } from "@/lib/db";
import { getMemberSession } from "@/lib/member-portal/session";
import { getMemberContext } from "@/lib/crm/rewards-server";
import { checkAvatarEligibility, getEntitlementSummary } from "@/lib/crm/collectibles-server";

/**
 * Redeem artwork memakai jatah tukar (EPIC-014 Task 3).
 *
 * Satu transaksi dengan kunci baris customer (`FOR UPDATE`) — dua permintaan
 * bersamaan diserialisasi sehingga jatah/stok tidak bisa dipakai dobel.
 * XP TIDAK berkurang; yang berkurang hanya sisa jatah (lewat ledger).
 */
export async function POST(request: Request) {
  try {
    const session = await getMemberSession();
    if (!session) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }
    const body = (await request.json().catch(() => ({}))) as { avatar_id?: unknown };
    const avatarId = typeof body.avatar_id === "string" ? body.avatar_id : "";
    if (!/^[0-9a-f-]{36}$/i.test(avatarId)) {
      return NextResponse.json({ success: false, error: "Artwork tidak valid" }, { status: 400 });
    }

    const result = await withTransaction(async (client) => {
      // Serialisasi per member: kunci baris customer.
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

      // Kunci baris artwork supaya pengecekan & penambahan stok konsisten.
      const { rows: lockRows } = await client.query(
        `SELECT id FROM crm.crm_collectible_avatars WHERE id = $1 FOR UPDATE`,
        [avatarId]
      );
      if (!lockRows[0]) return { status: 404 as const, error: "Artwork tidak ditemukan" };

      const { rows: ownedRows } = await client.query(
        `SELECT id FROM crm.crm_member_avatar_inventory WHERE member_id = $1 AND avatar_id = $2`,
        [member.memberProfileId, avatarId]
      );
      if (ownedRows[0]) return { status: 409 as const, error: "Artwork ini sudah kamu miliki" };

      const summary = await getEntitlementSummary(client, session.customerId, totalXp);
      if (summary.remaining <= 0) {
        return { status: 409 as const, error: "Jatah tukar kamu sudah habis — kumpulkan XP lagi." };
      }

      // Evaluasi ulang DI DALAM transaksi — satu aturan dari modul bersama.
      const eligibility = await checkAvatarEligibility(client, avatarId, session.customerId);
      if (!eligibility.allowed) {
        return { status: 409 as const, error: eligibility.reason ?? "Belum memenuhi syarat" };
      }

      // Stok bertambah hanya bila masih tersisa — guard di SQL, bukan aplikasi.
      const stockUpdate = await client.query(
        `UPDATE crm.crm_collectible_avatars
            SET stock_redeemed = COALESCE(stock_redeemed, 0) + 1
          WHERE id = $1
            AND (stock_total IS NULL OR COALESCE(stock_redeemed, 0) < stock_total)`,
        [avatarId]
      );
      if (stockUpdate.rowCount === 0) return { status: 409 as const, error: "Stok habis" };

      await client.query(
        `INSERT INTO crm.crm_member_entitlements (customer_id, member_id, asset_type, asset_id)
         VALUES ($1, $2, 'avatar', $3)`,
        [session.customerId, member.memberProfileId, avatarId]
      );
      await client.query(
        `INSERT INTO crm.crm_member_avatar_inventory (member_id, avatar_id, acquisition_source, is_equipped)
         VALUES ($1, $2, 'entitlement', false)`,
        [member.memberProfileId, avatarId]
      );

      const after = await getEntitlementSummary(client, session.customerId, totalXp);
      return { status: 200 as const, entitlement: after };
    });

    if (result.status !== 200) {
      return NextResponse.json({ success: false, error: result.error }, { status: result.status });
    }
    return NextResponse.json({
      success: true,
      message: "Artwork berhasil ditukar!",
      data: { entitlement: result.entitlement },
    });
  } catch (error) {
    // UNIQUE (customer, asset) menabrak = permintaan dobel yang kalah balapan.
    if (error instanceof Error && "code" in error && (error as { code?: string }).code === "23505") {
      return NextResponse.json({ success: false, error: "Artwork ini sudah kamu miliki" }, { status: 409 });
    }
    console.error("Error redeeming collectible:", error);
    return NextResponse.json({ success: false, error: "Penukaran gagal. Coba lagi." }, { status: 500 });
  }
}
