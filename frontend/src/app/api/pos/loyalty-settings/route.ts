import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireIamAction } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { createPgClient } from "@/lib/pg/create-client";
import { loadPosLoyaltySettings, savePosLoyaltySettings } from "@/lib/pos/loyalty-settings";
import { parseJsonBody, requirePosSession } from "@/lib/pos/route-guards";

const updateSchema = z.object({
  ark_rate: z.number().positive(),
  topup_min_amount: z.number().nonnegative(),
  topup_presets: z.array(z.number().positive()).min(1),
  topup_xp_enabled: z.boolean(),
  topup_xp_mode: z.enum(["fixed", "per_amount"]),
  topup_xp_value: z.number().nonnegative(),
  topup_xp_amount_step: z.number().positive(),
  spend_xp_enabled: z.boolean(),
  spend_xp_amount_step: z.number().positive(),
  spend_xp_min: z.number().int().nonnegative(),
});

/** GET: kasir butuh kurs ARK & preset top-up → cukup sesi POS. */
export const GET = apiHandler(async () => {
  await requirePosSession();
  return NextResponse.json({ success: true, data: await loadPosLoyaltySettings(createPgClient()) });
}, "pos/loyalty-settings");

/** PUT: mengubah kurs ARK = uang → wajib izin update menu ARK & XP (bukan sekadar sesi kasir). */
export const PUT = apiHandler(async (request: NextRequest) => {
  const user = await requireIamAction(IAM.posLoyaltySettings, "update");
  const body = await parseJsonBody(request, updateSchema, "Invalid payload");
  const data = await savePosLoyaltySettings(createPgClient(), body, user.id);
  return NextResponse.json({ success: true, data, message: "Loyalty settings saved" });
}, "pos/loyalty-settings");
