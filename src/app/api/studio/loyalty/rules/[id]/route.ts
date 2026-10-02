import { NextRequest, NextResponse } from "next/server";
import { ApiError, validateBody } from "@/lib/api/auth";
import { query } from "@/lib/db";
import { loyaltyRulePatchSchema } from "@/lib/studio/schemas";
import { requireStudioContext, studioRoute } from "@/lib/studio/server";

type Params = { params: Promise<{ id: string }> };

/** Ubah nilai XP / aktif / parameter satu aturan studio. */
export async function PATCH(request: NextRequest, { params }: Params) {
  return studioRoute("loyalty rule PATCH", async () => {
    await requireStudioContext("update", ["studio.loyalty"]);
    const { id } = await params;
    const b = await validateBody(request, loyaltyRulePatchSchema);
    const rows = await query(
      `UPDATE crm.crm_xp_rules SET
         xp_value = COALESCE($2, xp_value), amount_step = COALESCE($3, amount_step), is_active = COALESCE($4, is_active),
         metadata = CASE WHEN $5::jsonb IS NULL THEN metadata ELSE metadata || $5::jsonb END, updated_at = now()
       WHERE id = $1 AND source_channel = 'studio' RETURNING id, name`,
      [id, b.xp_value ?? null, b.amount_step ?? null, b.is_active ?? null, b.metadata ? JSON.stringify(b.metadata) : null]
    );
    if (!rows[0]) throw ApiError.notFound("Aturan XP tidak ditemukan");
    return NextResponse.json({ success: true, message: `Aturan "${(rows[0] as { name: string }).name}" disimpan` });
  });
}
