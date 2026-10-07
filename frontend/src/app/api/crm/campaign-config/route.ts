import { NextRequest } from "next/server";
import { z } from "zod";
import { requireIamMenuPrefix, successResponse, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { getSetting, setSetting } from "@/lib/settings/app-settings";
import { parseCampaignConfig } from "@/lib/crm/campaigns";
import { CAMPAIGN_CONFIG_KEY } from "@/lib/crm/campaigns-server";
import { requireCrmUser } from "@/lib/crm/guards";

// EPIC-033 — konfigurasi pengirim kampanye. GET: super_admin + marketing.
// PUT (termasuk MASTER SWITCH `enabled`): SUPER_ADMIN SAJA — menyalakan
// pengiriman = keputusan berisiko ban nomor WA (keputusan owner 26 Jul:
// tetap MATI sampai WA official siap).

const putSchema = z.object({
  enabled: z.boolean().optional(),
  daily_cap: z.number().int().min(1).max(2000).optional(),
});

async function readConfig() {
  const raw = await getSetting(CAMPAIGN_CONFIG_KEY);
  return parseCampaignConfig(raw ? JSON.parse(String(raw)) : null);
}

export const GET = apiHandler(async () => {
  await requireCrmUser("campaign");
  return successResponse(await readConfig());
}, "crm.campaign-config.GET");

export const PUT = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.crm);
  const patch = await validateBody(request, putSchema);
  const next = { ...(await readConfig()), ...patch };
  await setSetting(CAMPAIGN_CONFIG_KEY, JSON.stringify(next));
  return successResponse(next, "Konfigurasi tersimpan");
}, "crm.campaign-config.PUT");
