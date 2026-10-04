import { NextRequest, NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { requireCrmUser } from "@/lib/crm/guards";
import { loadLoyaltyReport, requireReportPeriod } from "@/lib/crm/reports-server";

/** EPIC-011 Fase E — laporan loyalti: top spender, pengunjung, rekonsiliasi ARK per venue. */
export const GET = apiHandler(async (request: NextRequest) => {
  await requireCrmUser("reports");
  const period = requireReportPeriod(request.nextUrl.searchParams);
  return NextResponse.json({ success: true, data: await loadLoyaltyReport(period) });
}, "crm.reports.GET");
