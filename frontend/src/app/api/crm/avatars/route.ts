import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, getPosSession, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { createPgClient } from "@/lib/pg/create-client";
import { crmSchemaError, requireCrmUser } from "@/lib/crm/guards";
import { isMissingCrmSchema } from "@/lib/crm/server";

const avatarSchema = z.object({
  code: z.string().trim().min(1).max(80).transform((value) => value.toLowerCase()),
  name: z.string().trim().min(1).max(120),
  rarity: z.enum(["common", "rare", "epic", "legendary", "limited"]).default("common"),
  image_url: z.string().trim().url(),
  thumbnail_url: z.string().trim().url().nullable().optional(),
  required_tier_id: z.string().uuid().nullable().optional(),
  xp_cost: z.number().int().nonnegative().default(0),
  stock_total: z.number().int().nonnegative().nullable().optional(),
  stock_redeemed: z.number().int().nonnegative().default(0),
  starts_at: z.string().datetime().nullable().optional(),
  ends_at: z.string().datetime().nullable().optional(),
  is_active: z.boolean().default(true),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export const GET = apiHandler(async (request: NextRequest) => {
  if (!(await getPosSession())) throw ApiError.unauthorized();
  const rarity = request.nextUrl.searchParams.get("rarity");
  let query = createPgClient()
    .from("crm_collectible_avatars")
    .select("*, required_tier:crm_membership_tiers(code, name, rank)")
    .order("created_at", { ascending: false });
  if (rarity) query = query.eq("rarity", rarity);

  const { data, error } = await query;
  if (error) {
    if (isMissingCrmSchema(error)) {
      return NextResponse.json({ success: true, data: [], meta: { schemaReady: false } });
    }
    throw error;
  }
  return NextResponse.json({ success: true, data: data ?? [], meta: { schemaReady: true } });
}, "crm.avatars.GET");

export const POST = apiHandler(async (request: NextRequest) => {
  await requireCrmUser("settings");
  const payload = await validateBody(request, avatarSchema);
  const { data, error } = await createPgClient()
    .from("crm_collectible_avatars")
    .upsert(payload, { onConflict: "code" })
    .select()
    .single();
  if (error) throw crmSchemaError(error);
  return NextResponse.json({ success: true, data });
}, "crm.avatars.POST");

export const DELETE = apiHandler(async (request: NextRequest) => {
  await requireCrmUser("settings");
  const avatarId = request.nextUrl.searchParams.get("id");
  if (!avatarId) throw ApiError.badRequest("Avatar id wajib diisi");

  const { error } = await createPgClient().from("crm_collectible_avatars").delete().eq("id", avatarId);
  if (error) {
    if (error.code === "23503") {
      throw ApiError.conflict("Avatar sudah terhubung dengan member/reward. Nonaktifkan avatar sebagai gantinya.");
    }
    throw crmSchemaError(error);
  }
  return NextResponse.json({ success: true });
}, "crm.avatars.DELETE");
