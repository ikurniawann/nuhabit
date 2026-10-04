import { NextRequest } from "next/server";
import { createdResponse, successResponse, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { requireCrmScope } from "@/lib/crm/guards";
import { reportSchema } from "@/lib/crm/report-builder";
import { createSavedReport, listSavedReports } from "@/lib/crm/saved-reports-server";

/** EPIC-050 T-4.1 — daftar & buat report tersimpan. */
export const GET = apiHandler(async (request: NextRequest) => {
  const { user, scope } = await requireCrmScope("reports");
  const dataset = request.nextUrl.searchParams.get("dataset");
  return successResponse(await listSavedReports(user, scope, dataset));
}, "crm.report-builder.GET");

export const POST = apiHandler(async (request: NextRequest) => {
  const { user, scope } = await requireCrmScope("reports");
  const body = await validateBody(request, reportSchema);
  return createdResponse(await createSavedReport(user, scope, body), "Report disimpan");
}, "crm.report-builder.POST");
