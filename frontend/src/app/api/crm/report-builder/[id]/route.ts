import { NextRequest } from "next/server";
import { noContentResponse, successResponse, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { requireCrmScope } from "@/lib/crm/guards";
import { patchSchemaOf } from "@/lib/crm/patch-schema";
import { reportSchema } from "@/lib/crm/report-builder";
import { parseStoredDefinition, runReportDefinition } from "@/lib/crm/report-builder-server";
import {
  requireAccessibleReport,
  requireEditableReport,
  softDeleteReport,
  updateSavedReport,
} from "@/lib/crm/saved-reports-server";

type Ctx = { params: Promise<{ id: string }> };

/** GET = jalankan report tersimpan (?meta=1 hanya definisi). */
export const GET = apiHandler(async (request: NextRequest, { params }: Ctx) => {
  const { user, scope } = await requireCrmScope("reports");
  const { id } = await params;
  const report = await requireAccessibleReport(id, user, scope);
  const definition = parseStoredDefinition(report.dataset, report.definition);
  if (request.nextUrl.searchParams.get("meta") === "1") {
    return successResponse({ report: { ...report, definition } });
  }
  const result = await runReportDefinition(definition, user, scope);
  return successResponse({ report: { ...report, definition }, result });
}, "crm.report-builder.[id].GET");

export const PATCH = apiHandler(async (request: NextRequest, { params }: Ctx) => {
  const { user, scope } = await requireCrmScope("reports");
  const { id } = await params;
  await requireEditableReport(id, user, scope, "mengubah");
  const patch = await validateBody(request, patchSchemaOf(reportSchema));
  return successResponse(await updateSavedReport(id, user, patch), "Report diperbarui");
}, "crm.report-builder.[id].PATCH");

export const DELETE = apiHandler(async (_request: NextRequest, { params }: Ctx) => {
  const { user, scope } = await requireCrmScope("reports");
  const { id } = await params;
  await requireEditableReport(id, user, scope, "menghapus");
  await softDeleteReport(id);
  return noContentResponse();
}, "crm.report-builder.[id].DELETE");
