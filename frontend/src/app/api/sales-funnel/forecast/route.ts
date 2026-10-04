import { NextRequest } from "next/server";
import { successResponse } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { loadForecast, parseMonthParam } from "@/lib/sales-funnel/forecast-server";
import { requireSalesFunnelUser, requireSalesScope } from "@/lib/sales-funnel/server";

/** EPIC-050 T-3.2 — GET ?month=YYYY-MM[&pipeline_id=] */
export const GET = apiHandler(async (request: NextRequest) => {
  const user = await requireSalesFunnelUser();
  const scope = await requireSalesScope(user);
  const searchParams = request.nextUrl.searchParams;
  const month = parseMonthParam(searchParams.get("month"));
  return successResponse(await loadForecast(user, scope, month, searchParams.get("pipeline_id")));
}, "sales-funnel.forecast.GET");
