import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getPool } from "@/lib/db";
import { getMemberSession } from "@/lib/member-portal/session";
import { getMemberContext } from "@/lib/crm/rewards-server";
import { equipCollectible } from "@/lib/crm/collectibles-server";

/**
 * EPIC-014 Task 1 — member memasang artwork miliknya sebagai avatar aktif.
 *
 * Kepemilikan diperiksa di server di dalam transaksi, bukan dipercayakan pada
 * UI: permintaan untuk artwork yang tidak dimiliki ditolak 403.
 */

const equipSchema = z.object({
  avatar_id: z.string().uuid(),
});

export async function POST(request: NextRequest) {
  try {
    const session = await getMemberSession();
    if (!session) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const payload = equipSchema.parse(await request.json());

    const pool = getPool();
    const member = await getMemberContext(pool, session.customerId);
    if (!member) {
      return NextResponse.json(
        { success: false, error: "Member tidak ditemukan" },
        { status: 404 }
      );
    }
    if (!member.memberProfileId) {
      return NextResponse.json(
        { success: false, error: "Profil member belum aktif" },
        { status: 409 }
      );
    }

    const result = await equipCollectible(pool, {
      memberProfileId: member.memberProfileId,
      avatarId: payload.avatar_id,
    });

    if (!result.ok) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: result.status }
      );
    }

    return NextResponse.json({ success: true, message: "Artwork terpasang." });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ success: false, error: "Artwork tidak valid" }, { status: 400 });
    }

    console.error("Error equipping member collectible:", error);
    return NextResponse.json({ success: false, error: "Gagal memasang artwork" }, { status: 500 });
  }
}
