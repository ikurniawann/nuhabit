import { NextRequest } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { requireIamMenuPrefix, successResponse } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { createServerPgClient } from "@/lib/pg/create-client";
import {
  buildPoDetail,
  loadPoLineItems,
  loadPurchaseOrders,
  poDetailCsvRows,
  poReportQuerySchema,
} from "@/lib/purchasing/report-po";
import { csvResponse, parseReportQuery, quotedCsv } from "@/lib/purchasing/report-query";

// GET /api/purchasing/reports/po-detail
export const GET = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.items);
  const db = await createServerPgClient();
  const params = parseReportQuery(request, poReportQuerySchema);

  const pos = await loadPurchaseOrders(db, params);
  // Tanpa PO: selalu JSON kosong, juga untuk export=csv (perilaku lama).
  if (pos.length === 0) return successResponse(buildPoDetail([], []));

  const items = await loadPoLineItems(db, pos.map((po) => po.id));
  const report = buildPoDetail(pos, items);

  if (params.export === "csv") {
    const { header, rows } = poDetailCsvRows(report.summary);
    return csvResponse(quotedCsv(header, rows), "po-detail");
  }
  return successResponse(report);
}, "purchasing.reports.po-detail");
