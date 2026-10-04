import type { NextRequest } from "next/server";
import { successResponse, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { campaignCreateSchema } from "@/lib/promo/campaign-schema";
import { createCampaign, listCampaigns } from "@/lib/promo/campaigns-server";
import { requirePromoContext } from "@/lib/promo/server";

// EPIC-032 A3 — daftar + buat campaign promo.

export const GET = apiHandler(async () => {
  const ctx = await requirePromoContext();
  return successResponse(await listCampaigns(ctx));
}, "promo.campaigns.GET");

export const POST = apiHandler(async (request: NextRequest) => {
  const ctx = await requirePromoContext();
  const body = await validateBody(request, campaignCreateSchema);
  return successResponse({ id: await createCampaign(ctx, body) }, "Campaign promo dibuat");
}, "promo.campaigns.POST");
