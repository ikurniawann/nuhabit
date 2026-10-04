import { NextRequest, NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { createServerPgClient } from "@/lib/pg/create-client";
import {
  buildPoSummary,
  loadPurchaseOrders,
  poReportQuerySchema,
  poSummaryCsv,
} from "@/lib/purchasing/report-po";
import { csvResponse, parseReportQuery } from "@/lib/purchasing/report-query";

// GET /api/purchasing/reports/po-summary
export const GET = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.items);
  const db = await createServerPgClient();
  const params = parseReportQuery(request, poReportQuerySchema);

  const report = buildPoSummary(await loadPurchaseOrders(db, params));
  if (params.export === "csv") return csvResponse(poSummaryCsv(report.summary), "po-summary");

  return NextResponse.json({ success: true, data: report });
}, "purchasing.reports.po-summary");
