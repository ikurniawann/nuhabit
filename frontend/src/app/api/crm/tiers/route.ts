import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, getPosSession, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { createPgClient } from "@/lib/pg/create-client";
import { crmSchemaError, requireCrmUser } from "@/lib/crm/guards";
import { CRM_DEFAULT_TIERS, isMissingCrmSchema } from "@/lib/crm/server";

const tierSchema = z.object({
  code: z.string().trim().min(1).max(40).transform((value) => value.toLowerCase()),
  name: z.string().trim().min(1).max(80),
  rank: z.number().int().nonnegative(),
  min_lifetime_xp: z.number().int().nonnegative().default(0),
  min_total_spend: z.number().nonnegative().default(0),
  xp_multiplier: z.number().nonnegative().default(1),
  discount_percent: z.number().min(0).max(100).default(0),
  benefits: z.array(z.string()).default([]),
  display_color: z.string().trim().min(1).default("#6B7280"),
  is_active: z.boolean().default(true),
});

export const GET = apiHandler(async () => {
  if (!(await getPosSession())) throw ApiError.unauthorized();
  const { data, error } = await createPgClient()
    .from("crm_membership_tiers")
    .select("*")
    .order("rank", { ascending: true });
  if (error) {
    if (isMissingCrmSchema(error)) {
      return NextResponse.json({ success: true, data: CRM_DEFAULT_TIERS, meta: { schemaReady: false } });
    }
    throw error;
  }
  return NextResponse.json({ success: true, data: data ?? [], meta: { schemaReady: true } });
}, "crm.tiers.GET");

export const POST = apiHandler(async (request: NextRequest) => {
  await requireCrmUser("settings");
  const payload = await validateBody(request, tierSchema);
  const { data, error } = await createPgClient()
    .from("crm_membership_tiers")
    // benefits di-stringify manual: driver pg menserialisasi array JS jadi
    // literal array Postgres ("{}"), bukan JSON — jsonb butuh string JSON.
    .upsert({ ...payload, benefits: JSON.stringify(payload.benefits) }, { onConflict: "code" })
    .select()
    .single();
  if (error) throw crmSchemaError(error);
  return NextResponse.json({ success: true, data });
}, "crm.tiers.POST");
