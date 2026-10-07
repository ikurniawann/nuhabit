import { NextRequest } from "next/server";
import { ApiError, noContentResponse, successResponse, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { requireCrmScope } from "@/lib/crm/guards";
import { patchSchemaOf } from "@/lib/crm/patch-schema";
import { reportScheduleSchema } from "@/lib/crm/report-schedule";
import { runReportSchedule } from "@/lib/crm/report-schedule-watcher";
import {
  assertCanManageSchedules,
  deleteReportSchedule,
  requireSchedule,
  updateReportSchedule,
} from "@/lib/crm/saved-reports-server";

type Ctx = { params: Promise<{ id: string }> };

/** Gate admin + jadwal di scope company (403 sebelum 404, seperti sebelumnya). */
async function manageableSchedule({ params }: Ctx, action: string) {
  const { user, scope } = await requireCrmScope("reports");
  assertCanManageSchedules(user, action);
  const { id } = await params;
  return requireSchedule(id, scope);
}

export const PATCH = apiHandler(async (request: NextRequest, ctx: Ctx) => {
  const current = await manageableSchedule(ctx, "mengubah jadwal");
  const patch = await validateBody(request, patchSchemaOf(reportScheduleSchema));
  return successResponse(await updateReportSchedule(current, patch), "Jadwal diperbarui");
}, "crm.report-schedules.[id].PATCH");

export const DELETE = apiHandler(async (_request: NextRequest, ctx: Ctx) => {
  const schedule = await manageableSchedule(ctx, "menghapus jadwal");
  await deleteReportSchedule(schedule.id);
  return noContentResponse();
}, "crm.report-schedules.[id].DELETE");

/** POST = kirim sekarang (uji coba), tanpa menggeser jadwal berikutnya. */
export const POST = apiHandler(async (_request: NextRequest, ctx: Ctx) => {
  const schedule = await manageableSchedule(ctx, "mengirim uji coba");
  const result = await runReportSchedule(schedule.id, { advanceNextRun: false });
  if (!result.ok) throw ApiError.badRequest(result.reason ?? "Gagal mengirim");
  return successResponse(result, `Terkirim ke ${result.sent} penerima`);
}, "crm.report-schedules.[id].POST");
