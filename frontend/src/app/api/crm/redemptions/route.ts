import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { getPool } from "@/lib/db";
import { requireCrmUser } from "@/lib/crm/guards";
import { isMissingRedemptionSchema, listRedemptions } from "@/lib/crm/redemption-queue-server";
import { createRedemption, updateRedemptionStatus, type CreateRedemptionResult } from "@/lib/crm/rewards-server";

/**
 * EPIC-011 Fase F — antrean & riwayat redeem reward.
 *
 * XP TIDAK dipotong: `min_xp` reward hanya syarat kelayakan. Yang membatasi
 * adalah kuota per member (max_redemptions_per_member × quota_period) dan stok.
 */

const claimSchema = z.object({
  customer_id: z.string().uuid(),
  reward_id: z.string().uuid(),
  notes: z.string().trim().max(500).nullable().optional(),
});

const updateSchema = z.object({
  id: z.string().uuid(),
  action: z.enum(["approve", "fulfill", "cancel"]),
  notes: z.string().trim().max(500).nullable().optional(),
});

function redemptionResponse(result: CreateRedemptionResult) {
  if (!result.ok) throw new ApiError(result.status, result.error);
  return NextResponse.json({ success: true, data: result.redemption });
}

export const GET = apiHandler(async (request: NextRequest) => {
  // Respons memuat PII member (nama/telepon/XP) — batasi ke peran ber-kebutuhan.
  await requireCrmUser("reader");
  const params = request.nextUrl.searchParams;
  try {
    const rows = await listRedemptions({
      status: params.get("status"),
      customerId: params.get("customer_id"),
      memberId: params.get("member_id"),
      limit: params.get("limit"),
    });
    return NextResponse.json({ success: true, data: rows, meta: { schemaReady: true } });
  } catch (error) {
    if (isMissingRedemptionSchema(error)) {
      return NextResponse.json({ success: true, data: [], meta: { schemaReady: false } });
    }
    throw error;
  }
}, "crm.redemptions.GET");

/** Kasir/admin mengklaim reward atas nama member di venue → langsung fulfilled. */
export const POST = apiHandler(async (request: NextRequest) => {
  const user = await requireCrmUser("operator");
  const payload = await validateBody(request, claimSchema);
  try {
    return redemptionResponse(
      await createRedemption(getPool(), {
        customerId: payload.customer_id,
        rewardId: payload.reward_id,
        channel: "admin",
        actorUserId: user.id,
        notes: payload.notes ?? null,
      })
    );
  } catch (error) {
    if (isMissingRedemptionSchema(error)) throw ApiError.conflict("Migrasi CRM Fase F belum diterapkan");
    throw error;
  }
}, "crm.redemptions.POST");

/** Approve / fulfill / cancel permintaan redeem yang datang dari portal member. */
export const PATCH = apiHandler(async (request: NextRequest) => {
  const user = await requireCrmUser("operator");
  const payload = await validateBody(request, updateSchema);
  return redemptionResponse(
    await updateRedemptionStatus(getPool(), {
      redemptionId: payload.id,
      action: payload.action,
      actorUserId: user.id,
      notes: payload.notes ?? null,
    })
  );
}, "crm.redemptions.PATCH");
