import { NextRequest } from "next/server";
import { successResponse } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { loadCampaignReport } from "@/lib/crm/campaigns-admin-server";
import { requireCrmUser } from "@/lib/crm/guards";

/** EPIC-033 Fase C — funnel kampanye: antrean → terkirim → voucher dipakai. */
export const GET = apiHandler(async (_request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  await requireCrmUser("campaign");
  const { id } = await params;
  return successResponse(await loadCampaignReport(id));
}, "crm.campaigns.[id].report.GET");
