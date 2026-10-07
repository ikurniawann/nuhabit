import { NextRequest, NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { realtimeKpi, realtimeQuerySchema } from "@/lib/hris/performance-repo";
import { requireWorkforceActor } from "@/lib/hris/workforce-route";
import { parseInput, searchParamsOf } from "@/lib/payroll/request-input";

/**
 * GET ?year&quarter: KPI berjalan kuartal ini, yaitu rata-rata quarter-to-date
 * scorecard bulanan per karyawan, dipantau sebelum siklus review dibuka.
 */
export const GET = apiHandler(async (request: NextRequest) => {
  const actor = await requireWorkforceActor();
  const q = parseInput(realtimeQuerySchema, searchParamsOf(request), "Periode tidak valid");
  const now = new Date();
  const data = await realtimeKpi(
    actor,
    q.year || now.getFullYear(),
    q.quarter || Math.floor(now.getMonth() / 3) + 1
  );
  return NextResponse.json({ data });
}, "hris/performance/realtime.GET");
