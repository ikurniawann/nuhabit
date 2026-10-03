import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { getMemberSession } from "@/lib/member-portal/session";
import { getMemberContext } from "@/lib/crm/rewards-server";
import { awardEligibleBadges } from "@/lib/crm/collectibles-server";
import { sendWhatsAppText } from "@/lib/whatsapp";

/**
 * Badge member (EPIC-014 Task 6). Pemberian dievaluasi lazily setiap dibaca:
 * idempotent (UNIQUE), tanpa jatah. Badge baru → notifikasi WA best-effort
 * lewat gateway yang sudah berjalan (gagal kirim tidak menggagalkan respons).
 */
export async function GET() {
  try {
    const session = await getMemberSession();
    if (!session) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

    const pool = getPool();
    const member = await getMemberContext(pool, session.customerId);
    if (!member) {
      return NextResponse.json({ success: false, error: "Member tidak ditemukan" }, { status: 404 });
    }

    const baru = await awardEligibleBadges(pool, session.customerId, member.memberProfileId, member.totalXp);
    if (baru.length > 0) {
      const { rows: phoneRows } = await pool.query(
        `SELECT phone FROM pos.pos_customers WHERE id = $1`,
        [session.customerId]
      );
      const phone = phoneRows[0]?.phone as string | undefined;
      if (phone) {
        const nama = baru.map((b) => b.name).join(", ");
        void sendWhatsAppText(
          {
            target: phone,
            message: `Selamat! Kamu baru saja meraih badge: ${nama}. Lihat di portal member ya 🏅`,
          },
          { messageType: "notification" }
        ).catch((err: unknown) => console.warn("[badges] notif WA gagal:", err));
      }
    }

    const { rows } = await pool.query(
      `SELECT b.id, b.code, b.name, b.image_url, b.min_lifetime_xp::int,
              b.metric, b.threshold::float AS threshold,
              mb.id AS award_id, mb.awarded_at, mb.is_showcased
         FROM crm.crm_badges b
         LEFT JOIN crm.crm_member_badges mb
                ON mb.badge_id = b.id AND mb.customer_id = $1
        WHERE b.is_active OR mb.id IS NOT NULL
        ORDER BY b.min_lifetime_xp`,
      [session.customerId]
    );

    return NextResponse.json({
      success: true,
      data: {
        total_xp: member.totalXp,
        badges: rows.map((r) => ({
          id: r.id,
          code: r.code,
          name: r.name,
          image_url: r.image_url,
          min_lifetime_xp: Number(r.min_lifetime_xp ?? 0),
          // Syarat badge: lifetime_xp | visits | spend_idr | streak_weeks | manual.
          metric: r.metric ?? "lifetime_xp",
          threshold: r.threshold === null || r.threshold === undefined ? null : Number(r.threshold),
          owned: r.award_id != null,
          awarded_at: r.awarded_at,
          is_showcased: r.is_showcased === true,
        })),
      },
    });
  } catch (error) {
    console.error("Error fetching member badges:", error);
    return NextResponse.json({ success: false, error: "Gagal memuat badge" }, { status: 500 });
  }
}

/** Pamerkan/sembunyikan badge — maksimal 3 dipamerkan. */
export async function POST(request: Request) {
  try {
    const session = await getMemberSession();
    if (!session) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    const body = (await request.json().catch(() => ({}))) as { badge_id?: unknown; showcased?: unknown };
    const badgeId = typeof body.badge_id === "string" ? body.badge_id : "";
    const showcased = body.showcased === true;
    if (!/^[0-9a-f-]{36}$/i.test(badgeId)) {
      return NextResponse.json({ success: false, error: "Badge tidak valid" }, { status: 400 });
    }

    const pool = getPool();
    if (showcased) {
      const { rows } = await pool.query(
        `SELECT count(*)::int AS n FROM crm.crm_member_badges WHERE customer_id = $1 AND is_showcased`,
        [session.customerId]
      );
      if (Number(rows[0]?.n ?? 0) >= 3) {
        return NextResponse.json(
          { success: false, error: "Maksimal 3 badge dipamerkan — sembunyikan salah satu dulu." },
          { status: 409 }
        );
      }
    }
    const updated = await pool.query(
      `UPDATE crm.crm_member_badges SET is_showcased = $3
        WHERE customer_id = $1 AND badge_id = $2`,
      [session.customerId, badgeId, showcased]
    );
    if (updated.rowCount === 0) {
      return NextResponse.json({ success: false, error: "Badge belum kamu miliki" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error updating badge showcase:", error);
    return NextResponse.json({ success: false, error: "Gagal menyimpan" }, { status: 500 });
  }
}
