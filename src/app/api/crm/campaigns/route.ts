import { NextRequest } from "next/server";
import { ApiError, successResponse, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import {
  campaignVenue,
  createCampaign,
  createCampaignSchema,
  listCampaigns,
  VENUE_NOT_CONFIGURED,
} from "@/lib/crm/campaigns-admin-server";
import { requireCrmUser } from "@/lib/crm/guards";

// EPIC-033 — daftar + buat kampanye WA. Pengelola: super_admin + marketing.

export const GET = apiHandler(async () => {
  await requireCrmUser("campaign");
  const { branchId } = await campaignVenue();
  if (!branchId) throw ApiError.badRequest(VENUE_NOT_CONFIGURED);
  return successResponse(await listCampaigns(branchId));
}, "crm.campaigns.GET");

export const POST = apiHandler(async (request: NextRequest) => {
  const user = await requireCrmUser("campaign");
  const body = await validateBody(request, createCampaignSchema);
  const { id, scheduled } = await createCampaign(body, user.id);
  return successResponse({ id }, scheduled ? "Kampanye dijadwalkan" : "Kampanye dibuat (draft)");
}, "crm.campaigns.POST");
