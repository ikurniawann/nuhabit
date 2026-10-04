import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, getPosSession, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { createPgClient } from "@/lib/pg/create-client";
import { crmSchemaError, requireCrmUser } from "@/lib/crm/guards";
import { QUOTA_PERIODS } from "@/lib/crm/rewards";
import { isMissingCrmSchema } from "@/lib/crm/server";

const rewardSchema = z.object({
  code: z.string().trim().min(1).max(80).transform((value) => value.toLowerCase()),
  name: z.string().trim().min(1).max(120),
  reward_type: z.enum(["discount", "merchandise", "avatar", "voucher", "ark_coin", "custom"]),
  // Syarat kelayakan, BUKAN biaya: XP member tidak dipotong saat redeem.
  min_xp: z.number().int().nonnegative(),
  required_tier_id: z.string().uuid().nullable().optional(),
  linked_avatar_id: z.string().uuid().nullable().optional(),
  stock_total: z.number().int().nonnegative().nullable().optional(),
  stock_redeemed: z.number().int().nonnegative().default(0),
  max_redemptions_per_member: z.number().int().positive().nullable().optional(),
  quota_period: z.enum(QUOTA_PERIODS).default("total"),
  image_url: z.string().trim().url().nullable().optional(),
  reward_data: z.record(z.string(), z.unknown()).default({}),
  starts_at: z.string().datetime().nullable().optional(),
  ends_at: z.string().datetime().nullable().optional(),
  is_active: z.boolean().default(true),
});

export const GET = apiHandler(async (request: NextRequest) => {
  if (!(await getPosSession())) throw ApiError.unauthorized();
  const rewardType = request.nextUrl.searchParams.get("reward_type");
  const includeAvatarRewards = request.nextUrl.searchParams.get("include_avatar_rewards") === "true";

  let query = createPgClient()
    .from("crm_rewards")
    .select("*, required_tier:crm_membership_tiers(code, name, rank)")
    .order("created_at", { ascending: false });
  if (rewardType) query = query.eq("reward_type", rewardType);
  if (!rewardType && !includeAvatarRewards) query = query.neq("reward_type", "avatar");

  const { data, error } = await query;
  if (error) {
    if (isMissingCrmSchema(error)) {
      return NextResponse.json({ success: true, data: [], meta: { schemaReady: false } });
    }
    throw error;
  }
  return NextResponse.json({ success: true, data: data ?? [], meta: { schemaReady: true } });
}, "crm.rewards.GET");

export const POST = apiHandler(async (request: NextRequest) => {
  await requireCrmUser("settings");
  const payload = await validateBody(request, rewardSchema);
  const { data, error } = await createPgClient()
    .from("crm_rewards")
    .upsert(payload, { onConflict: "code" })
    .select()
    .single();
  if (error) throw crmSchemaError(error);
  return NextResponse.json({ success: true, data });
}, "crm.rewards.POST");

export const DELETE = apiHandler(async (request: NextRequest) => {
  await requireCrmUser("settings");
  const rewardId = request.nextUrl.searchParams.get("id");
  if (!rewardId) throw ApiError.badRequest("Reward id wajib diisi");

  const { error } = await createPgClient().from("crm_rewards").delete().eq("id", rewardId);
  if (error) {
    if (error.code === "23503") {
      throw ApiError.conflict(
        "Reward sudah memiliki redemption dan tidak bisa dihapus. Nonaktifkan reward sebagai gantinya."
      );
    }
    throw crmSchemaError(error);
  }
  return NextResponse.json({ success: true });
}, "crm.rewards.DELETE");
