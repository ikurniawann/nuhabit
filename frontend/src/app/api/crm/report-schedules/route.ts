import { NextRequest } from "next/server";
import { createdResponse, successResponse, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { requireCrmScope } from "@/lib/crm/guards";
import { reportScheduleSchema } from "@/lib/crm/report-schedule";
import {
  assertCanManageSchedules,
  createReportSchedule,
  listReportSchedules,
} from "@/lib/crm/saved-reports-server";

/** EPIC-050 T-4.3 — daftar & buat report terjadwal. */
export const GET = apiHandler(async () => {
  const { scope } = await requireCrmScope("reports");
  return successResponse(await listReportSchedules(scope));
}, "crm.report-schedules.GET");

export const POST = apiHandler(async (request: NextRequest) => {
  const { user, scope } = await requireCrmScope("reports");
  assertCanManageSchedules(user, "membuat laporan terjadwal");
  const body = await validateBody(request, reportScheduleSchema);
  return createdResponse(await createReportSchedule(user, scope, body), "Jadwal dibuat");
}, "crm.report-schedules.POST");
