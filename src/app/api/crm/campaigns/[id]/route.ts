import { NextRequest } from "next/server";
import { successResponse, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { applyCampaignPatch, patchCampaignSchema, requireCampaign } from "@/lib/crm/campaigns-admin-server";
import { requireCrmUser } from "@/lib/crm/guards";

// EPIC-033 — aksi satu kampanye: edit (draft), start (build antrean →
// sending), schedule (kirim nanti), pause/resume, cancel. Build antrean
// idempoten; PENGIRIMAN WA tetap di tangan watcher + master switch.

export const PATCH = apiHandler(async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  await requireCrmUser("campaign");
  const { id } = await params;
  const body = await validateBody(request, patchCampaignSchema);
  const campaign = await requireCampaign(id);
  const { data, message } = await applyCampaignPatch(campaign, body);
  return successResponse(data, message);
}, "crm.campaigns.[id].PATCH");
