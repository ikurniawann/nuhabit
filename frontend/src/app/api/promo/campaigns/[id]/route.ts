import type { NextRequest } from "next/server";
import { successResponse, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { campaignPatchSchema } from "@/lib/promo/campaign-schema";
import { updateCampaign } from "@/lib/promo/campaigns-server";
import { requirePromoContext } from "@/lib/promo/server";

type Ctx = { params: Promise<{ id: string }> };

// EPIC-032 A3 — edit campaign. Toggle aktif selalu boleh; edit aturan/diskon
// hanya jika belum ada redemption captured.
export const PATCH = apiHandler(async (request: NextRequest, { params }: Ctx) => {
  const ctx = await requirePromoContext();
  const { id } = await params;
  const body = await validateBody(request, campaignPatchSchema);
  await updateCampaign(ctx, id, body);
  return successResponse({ id }, "Campaign diperbarui");
}, "promo.campaigns.id.PATCH");
