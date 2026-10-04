import { NextRequest } from "next/server";
import { successResponse } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { normalizeSegment } from "@/lib/crm/campaigns";
import { requireCampaignVenue } from "@/lib/crm/campaigns-admin-server";
import { previewSegment } from "@/lib/crm/campaigns-server";
import { requireCrmUser } from "@/lib/crm/guards";

// EPIC-033 — preview segmen TANPA kirim: jumlah penerima (minus opt-out)
// + 5 sampel. Dipakai form kampanye sebelum owner menekan mulai.

export const POST = apiHandler(async (request: NextRequest) => {
  await requireCrmUser("campaign");
  const body = (await request.json()) as { segment?: unknown; segment_id?: string | null };
  const venue = await requireCampaignVenue();
  const preview = await previewSegment(
    venue,
    normalizeSegment(body.segment),
    body.segment_id ?? null
  );
  return successResponse(preview);
}, "crm.campaigns.preview.POST");
