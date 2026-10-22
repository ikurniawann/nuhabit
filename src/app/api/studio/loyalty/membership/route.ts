import { NextRequest, NextResponse } from "next/server";
import { validateBody } from "@/lib/api/auth";
import { query, queryOne } from "@/lib/db";
import { cleanPerks } from "@/lib/studio/membership";
import { evaluateAllMemberships, loadMembershipTiers, membershipTierCounts } from "@/lib/studio/membership-server";
import { membershipTierSchema } from "@/lib/studio/schemas";
import { requireStudioContext, studioRoute } from "@/lib/studio/server";

/** Membership (EPIC-069): tangga tier spending, jumlah member per tier, perubahan tier terakhir. */
export async function GET() {
  return studioRoute("membership GET", async () => {
    await requireStudioContext(undefined, ["studio.loyalty"]);
    const [tiers, counts, changes, members] = await Promise.all([
      loadMembershipTiers(),
      membershipTierCounts(),
      query(
        `SELECT ch.id, ch.direction, ch.from_tier_name, ch.to_tier_name, ch.spend_12m::float8 AS spend_12m, ch.created_at,
                c.name AS customer_name, c.phone
         FROM studio.membership_tier_changes ch JOIN pos.pos_customers c ON c.id = ch.customer_id
         ORDER BY ch.created_at DESC LIMIT 20`
      ),
      queryOne<{ n: number }>(`SELECT COUNT(*)::int AS n FROM studio.member_memberships WHERE spend_12m > 0`),
    ]);
    return NextResponse.json({
      success: true,
      data: {
        tiers: tiers.map((t) => ({ ...t, members: counts[t.id] ?? 0 })),
        members_with_spend: members?.n ?? 0,
        recent_changes: changes,
      },
    });
  });
}

/** Tambah tier Membership; semua member dievaluasi ulang. */
export async function POST(request: NextRequest) {
  return studioRoute("membership POST", async () => {
    const ctx = await requireStudioContext("create", ["studio.loyalty"]);
    const b = await validateBody(request, membershipTierSchema);
    const row = await queryOne<{ id: string; name: string }>(
      `INSERT INTO studio.membership_tiers (name, min_spend, display_color, discount_percent, early_booking_days, cancel_window_hours, waitlist_priority, perks, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id, name`,
      [b.name, b.min_spend, b.display_color, b.discount_percent, b.early_booking_days, b.cancel_window_hours, b.waitlist_priority, cleanPerks(b.perks), ctx.user.id]
    );
    const moved = await evaluateAllMemberships();
    return NextResponse.json(
      { success: true, data: row, message: `Tier ${row?.name} ditambahkan${moved ? ` · ${moved} member pindah tier` : ""}` },
      { status: 201 }
    );
  });
}
