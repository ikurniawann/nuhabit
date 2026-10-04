import { NextRequest } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { xlsxResponse } from "@/lib/reports/xlsx";
import { requireCrmScope } from "@/lib/crm/guards";
import {
  buildReportSheets, parseStoredDefinition, reportFileName, runReportDefinition,
} from "@/lib/crm/report-builder-server";
import { requireAccessibleReport } from "@/lib/crm/saved-reports-server";

/** EPIC-050 T-4.1 — ekspor report tersimpan ke XLSX (sheet Data + Info). */
export const GET = apiHandler(async (_request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { user, scope } = await requireCrmScope("reports");
  const { id } = await params;
  const report = await requireAccessibleReport(id, user, scope);
  const definition = parseStoredDefinition(report.dataset, report.definition);
  const result = await runReportDefinition(definition, user, scope);
  const now = new Date();
  return xlsxResponse(buildReportSheets(report, definition, result, now), reportFileName(report.name, now));
}, "crm.report-builder.[id].export.GET");
