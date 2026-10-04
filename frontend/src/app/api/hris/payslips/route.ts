import { NextRequest, NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { requireWorkforceActor } from "@/lib/hris/workforce-route";
import { createServerPgClient } from "@/lib/pg/create-client";
import { listPayslips, payslipListQuerySchema } from "@/lib/payroll/payslips";
import { parseInput, searchParamsOf } from "@/lib/payroll/request-input";

/**
 * GET /api/hris/payslips. HR/finance melihat semua slip (filter bebas);
 * karyawan atau employee_id=me: hanya slip miliknya dari run PAID.
 */
export const GET = apiHandler(async (request: NextRequest) => {
  const actor = await requireWorkforceActor();
  const filter = parseInput(payslipListQuerySchema, searchParamsOf(request));
  const data = await listPayslips(await createServerPgClient(), actor, filter);
  return NextResponse.json({ data });
}, "hris/payslips.GET");
