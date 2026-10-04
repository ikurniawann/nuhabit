import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireIamGuard } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { loadHrisReport } from "@/lib/hris/reports-summary";
import { IAM } from "@/lib/iam/prefixes";
import { createServerPgClient } from "@/lib/pg/create-client";
import { parseInput, searchParamsOf } from "@/lib/payroll/request-input";

const querySchema = z.object({
  month: z.coerce.number().int().min(1).max(12).optional(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
});

/** GET /api/hris/reports?month&year: ringkasan headcount, absensi, cuti per bulan. */
export const GET = apiHandler(async (request: NextRequest) => {
  const guard = await requireIamGuard(IAM.hrisInsights);
  if (guard.error) return guard.error;
  const now = new Date();
  const q = parseInput(querySchema, searchParamsOf(request), "Periode tidak valid");
  const report = await loadHrisReport(
    await createServerPgClient(),
    q.month ?? now.getMonth() + 1,
    q.year ?? now.getFullYear()
  );
  return NextResponse.json(report);
}, "hris/reports.GET");
