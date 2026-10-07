import type { NextRequest } from "next/server";
import { successResponse } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { requireCrmUser } from "@/lib/crm/guards";
import { listPartnerEvents } from "@/lib/crm/partners-admin-server";

/** GET — 200 event terbaru; filter partner_id & status. */
export const GET = apiHandler(async (request: NextRequest) => {
  await requireCrmUser("partners");
  const sp = request.nextUrl.searchParams;
  return successResponse(await listPartnerEvents(sp.get("partner_id"), sp.get("status")));
}, "crm.partners.events.GET");
