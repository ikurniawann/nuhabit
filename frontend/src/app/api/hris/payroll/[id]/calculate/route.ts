import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { createServerPgClient } from "@/lib/pg/create-client";
import { readOptionalJson } from "@/lib/payroll/request-input";
import { calculatePayrollRun } from "@/lib/payroll/run-calculation";

type Ctx = { params: Promise<{ id: string }> };

const calculateSchema = z.object({ include_thr: z.boolean().nullish() });

/** POST /api/hris/payroll/[id]/calculate: hitung ulang seluruh karyawan aktif. */
export const POST = apiHandler(async (request: NextRequest, { params }: Ctx) => {
  await requireIamMenuPrefix(IAM.hrisCompensation);
  const { id } = await params;
  const body = await readOptionalJson(request, calculateSchema);
  const result = await calculatePayrollRun(await createServerPgClient(), id, {
    includeThr: body.include_thr ?? false,
  });
  return NextResponse.json(result);
}, "hris/payroll/[id]/calculate.POST");
