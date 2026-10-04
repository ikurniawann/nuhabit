import { successResponse } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { loadCheckinLog } from "@/lib/crm/engagement/admin-server";
import { requireCrmUser } from "@/lib/crm/guards";

/** GET — 200 scan QR terakhir (diterima maupun ditolak) + ringkasan hari ini. */
export const GET = apiHandler(async () => {
  await requireCrmUser("engagement");
  return successResponse(await loadCheckinLog());
}, "crm.engagement.checkins.GET");
