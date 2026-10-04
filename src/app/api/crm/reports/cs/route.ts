import { NextRequest, NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { requireCrmUser } from "@/lib/crm/guards";
import { loadCsReport, requireReportPeriod } from "@/lib/crm/reports-server";

/**
 * EPIC-012 Fase E — laporan customer service. Gate menu laporan CRM.
 * Respons sengaja TIDAK memuat isi chat maupun nomor customer.
 */
export const GET = apiHandler(async (request: NextRequest) => {
  await requireCrmUser("reports");
  const period = requireReportPeriod(request.nextUrl.searchParams);
  return NextResponse.json({ success: true, data: await loadCsReport(period) });
}, "crm.reports.cs.GET");
