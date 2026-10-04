import { NextRequest, NextResponse } from "next/server";
import { ApiError } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { loadPosDashboard } from "@/lib/pos/dashboard-server";
import { customRange, periodRange, previousRange, type DashboardPeriod } from "@/lib/pos/dashboard-stats";
import { requirePosSession } from "@/lib/pos/route-guards";

const PERIODS: DashboardPeriod[] = ["today", "week", "month", "custom"];

/** GET /api/pos/dashboard?period=today|week|month|custom[&date_from&date_to] — statistik dashboard POS (WIB). */
export const GET = apiHandler(async (request: NextRequest) => {
  await requirePosSession();
  const params = request.nextUrl.searchParams;
  const requested = params.get("period") || "today";
  const period = (PERIODS as string[]).includes(requested) ? (requested as DashboardPeriod) : "month";

  const range =
    period === "custom"
      ? customRange(params.get("date_from") || "", params.get("date_to") || "")
      : periodRange(period);
  if (!range) throw ApiError.badRequest("Rentang tanggal tidak valid (maks 366 hari, format YYYY-MM-DD)");

  const data = await loadPosDashboard(period, { ...range, ...previousRange(range.startDate, range.endDate) });
  return NextResponse.json({ success: true, data });
}, "pos/dashboard");
