import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, getPosSession, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { createPgClient } from "@/lib/pg/create-client";
import { crmSchemaError, requireCrmUser } from "@/lib/crm/guards";
import { isMissingCrmSchema } from "@/lib/crm/server";

const xpRuleSchema = z.object({
  code: z.string().trim().min(1).max(80).transform((value) => value.toLowerCase()),
  name: z.string().trim().min(1).max(120),
  source_channel: z.enum(["pos", "photobooth", "studio_game", "manual", "campaign"]),
  source_type: z.string().trim().min(1).max(80),
  source_id: z.string().trim().max(120).nullable().optional(),
  outlet_scope: z.enum(["all", "specific"]).default("all"),
  outlet_id: z.string().uuid().nullable().optional(),
  xp_mode: z.enum(["fixed", "per_item", "per_amount", "multiplier", "percentage"]),
  xp_value: z.number().nonnegative(),
  amount_step: z.number().positive().default(1),
  min_amount: z.number().nonnegative().default(0),
  max_xp_per_event: z.number().int().nonnegative().nullable().optional(),
  tier_multiplier_enabled: z.boolean().default(true),
  priority: z.number().int().default(100),
  starts_at: z.string().datetime().nullable().optional(),
  ends_at: z.string().datetime().nullable().optional(),
  is_active: z.boolean().default(true),
  metadata: z.record(z.string(), z.unknown()).default({}),
}).refine(
  (value) => value.outlet_scope === "all" ? !value.outlet_id : Boolean(value.outlet_id),
  { message: "outlet_id wajib diisi jika outlet_scope specific", path: ["outlet_id"] }
);

export const GET = apiHandler(async (request: NextRequest) => {
  if (!(await getPosSession())) throw ApiError.unauthorized();

  const sourceChannel = request.nextUrl.searchParams.get("source_channel");
  let query = createPgClient()
    .from("crm_xp_rules")
    .select("*")
    .order("priority", { ascending: true })
    .order("created_at", { ascending: false });
  if (sourceChannel) query = query.eq("source_channel", sourceChannel);

  const { data, error } = await query;
  if (error) {
    if (isMissingCrmSchema(error)) {
      return NextResponse.json({ success: true, data: [], meta: { schemaReady: false } });
    }
    throw error;
  }
  return NextResponse.json({ success: true, data: data ?? [], meta: { schemaReady: true } });
}, "crm.xp-rules.GET");

export const POST = apiHandler(async (request: NextRequest) => {
  await requireCrmUser("settings");
  const payload = await validateBody(request, xpRuleSchema);
  const { data, error } = await createPgClient()
    .from("crm_xp_rules")
    .upsert(payload, { onConflict: "code" })
    .select()
    .single();
  if (error) throw crmSchemaError(error);
  return NextResponse.json({ success: true, data });
}, "crm.xp-rules.POST");
