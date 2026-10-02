import { NextRequest, NextResponse } from "next/server";
import { ApiError, validateBody } from "@/lib/api/auth";
import { query } from "@/lib/db";
import { resyncAllTiers } from "@/lib/studio/loyalty-server";
import { loyaltyTierPatchSchema } from "@/lib/studio/schemas";
import { requireStudioContext, studioRoute } from "@/lib/studio/server";

type Params = { params: Promise<{ id: string }> };

/** Ubah nama, ambang XP, diskon F&B, dan benefit booking satu tier. */
export async function PATCH(request: NextRequest, { params }: Params) {
  return studioRoute("loyalty tier PATCH", async () => {
    await requireStudioContext("update", ["studio.loyalty"]);
    const { id } = await params;
    const b = await validateBody(request, loyaltyTierPatchSchema);
    const meta: Record<string, unknown> = {};
    if (b.early_booking_days !== undefined) meta.early_booking_days = b.early_booking_days;
    if (b.cancel_window_hours !== undefined) meta.cancel_window_hours = b.cancel_window_hours;
    if (b.waitlist_priority !== undefined) meta.waitlist_priority = b.waitlist_priority;
    if (b.min_lifetime_xp !== undefined) {
      const clash = await query(
        `SELECT name FROM crm.crm_membership_tiers WHERE is_active AND id <> $1 AND min_lifetime_xp = $2`,
        [id, b.min_lifetime_xp]
      );
      if (clash.length) throw ApiError.conflict(`Ambang XP sama dengan tier ${(clash[0] as { name: string }).name}`);
    }
    const rows = await query(
      `UPDATE crm.crm_membership_tiers SET name = COALESCE($2, name), min_lifetime_xp = COALESCE($3, min_lifetime_xp),
         discount_percent = COALESCE($4, discount_percent), metadata = metadata || $5::jsonb, updated_at = now()
       WHERE id = $1 RETURNING id, name`,
      [id, b.name ?? null, b.min_lifetime_xp ?? null, b.discount_percent ?? null, JSON.stringify(meta)]
    );
    if (!rows[0]) throw ApiError.notFound("Tier tidak ditemukan");
    const moved = b.min_lifetime_xp !== undefined ? await resyncAllTiers() : 0;
    return NextResponse.json({
      success: true,
      message: `Tier ${(rows[0] as { name: string }).name} disimpan${moved ? ` · ${moved} member pindah tier` : ""}`,
    });
  });
}
