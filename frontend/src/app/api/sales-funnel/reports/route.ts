import { NextRequest } from "next/server";
import { successResponse } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { loadFunnelReport, resolveReportPeriod } from "@/lib/sales-funnel/reports-server";
import { requireSalesFunnelUser, requireSalesScope } from "@/lib/sales-funnel/server";

/** Laporan Funnel (EPIC-022 Fase E) — satu endpoint agregat, ?from=&to= (YYYY-MM-DD). */
export const GET = apiHandler(async (request: NextRequest) => {
  const user = await requireSalesFunnelUser();
  const scope = await requireSalesScope(user);
  const searchParams = request.nextUrl.searchParams;
  const period = resolveReportPeriod(searchParams.get("from"), searchParams.get("to"));
  return successResponse(await loadFunnelReport(user, scope, period));
}, "sales-funnel.reports.GET");
