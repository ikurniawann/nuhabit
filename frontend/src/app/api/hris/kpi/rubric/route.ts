import { NextRequest, NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { requireWorkforceActor } from "@/lib/hris/workforce-route";
import { rubricSchema, saveRubric } from "@/lib/kpi/rubric";
import { readOptionalJson } from "@/lib/payroll/request-input";

/**
 * POST { employee_id, period_month, period_year, value, notes? }: penilaian
 * atasan (rubrik 1–5). Scorecard final ditolak (409).
 */
export const POST = apiHandler(async (request: NextRequest) => {
  const actor = await requireWorkforceActor();
  const input = await readOptionalJson(request, rubricSchema);
  return NextResponse.json({
    data: await saveRubric(actor, input),
    message: "Rubrik tersimpan & scorecard diperbarui",
  });
}, "hris/kpi/rubric.POST");
