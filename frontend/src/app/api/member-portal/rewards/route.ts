import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getPool } from "@/lib/db";
import { getMemberSession } from "@/lib/member-portal/session";
import {
  createRedemption,
  evaluateCatalogForMember,
  getMemberContext,
  listRedeemableRewards,
} from "@/lib/crm/rewards-server";
import { checkRedeemRateLimit, QUOTA_PERIOD_LABELS } from "@/lib/crm/rewards";

/**
 * EPIC-011 Fase F — katalog reward di portal member.
 *
 * XP member TIDAK berkurang saat redeem; `min_xp` hanya syarat kelayakan.
 * Member mengajukan (status pending), kasir/admin yang menyerahkan barangnya.
 */

const redeemSchema = z.object({
  reward_id: z.string().uuid(),
});

export async function GET() {
  try {
    const session = await getMemberSession();
    if (!session) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const pool = getPool();
    const member = await getMemberContext(pool, session.customerId);
    if (!member) {
      return NextResponse.json({ success: false, error: "Member tidak ditemukan" }, { status: 404 });
    }

    const rewards = await listRedeemableRewards(pool);
    const eligibility = await evaluateCatalogForMember(pool, rewards, member);

    const { rows: history } = await pool.query(
      `SELECT r.id, r.redemption_number, r.status, r.requested_at, r.fulfilled_at,
              w.name AS reward_name, w.reward_type
         FROM crm.crm_redemptions r
         JOIN crm.crm_rewards w ON w.id = r.reward_id
        WHERE r.customer_id = $1
        ORDER BY r.requested_at DESC
        LIMIT 20`,
      [session.customerId]
    );

    return NextResponse.json({
      success: true,
      data: {
        member: {
          name: member.name,
          total_xp: member.totalXp,
          tier_name: member.tierName,
        },
        rewards: rewards.map((reward) => {
          const check = eligibility.get(reward.id);
          return {
            id: reward.id,
            code: reward.code,
            name: reward.name,
            reward_type: reward.reward_type,
            min_xp: Number(reward.min_xp) || 0,
            required_tier_name: reward.required_tier_name,
            image_url: reward.image_url,
            quota_period: reward.quota_period,
            quota_period_label: QUOTA_PERIOD_LABELS[reward.quota_period],
            max_redemptions_per_member: reward.max_redemptions_per_member,
            eligible: check?.eligible ?? false,
            reason: check?.reason ?? null,
            xp_needed: check?.xp_needed ?? 0,
            remaining_stock: check?.remaining_stock ?? null,
            remaining_quota: check?.remaining_quota ?? null,
          };
        }),
        history,
      },
    });
  } catch (error) {
    console.error("Error fetching member portal rewards:", error);
    return NextResponse.json(
      { success: false, error: "Gagal memuat rewards" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getMemberSession();
    if (!session) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const rateLimit = checkRedeemRateLimit(session.customerId);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { success: false, error: "Terlalu banyak percobaan. Coba lagi sebentar lagi." },
        {
          status: 429,
          headers: { "Retry-After": String(Math.ceil(rateLimit.retryAfterMs / 1000)) },
        }
      );
    }

    const payload = redeemSchema.parse(await request.json());
    const result = await createRedemption(getPool(), {
      customerId: session.customerId,
      rewardId: payload.reward_id,
      channel: "portal",
      actorUserId: null,
    });

    if (!result.ok) {
      return NextResponse.json({ success: false, error: result.error }, { status: result.status });
    }

    return NextResponse.json({
      success: true,
      data: result.redemption,
      message: "Permintaan redeem terkirim. Tunjukkan kode ini ke kasir untuk pengambilan.",
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ success: false, error: "Reward tidak valid" }, { status: 400 });
    }

    console.error("Error creating member portal redemption:", error);
    return NextResponse.json({ success: false, error: "Gagal mengajukan redeem" }, { status: 500 });
  }
}
