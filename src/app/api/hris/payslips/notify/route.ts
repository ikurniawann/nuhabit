import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { readJson } from "@/lib/hris/workforce-route";
import { IAM } from "@/lib/iam/prefixes";
import { createServerPgClient } from "@/lib/pg/create-client";
import { notifyPayslip } from "@/lib/payroll/payslips";

const notifySchema = z.object({ payroll_detail_id: z.string().uuid() });

/** POST /api/hris/payslips/notify: tandai slip terkirim + link WhatsApp "slip terbit". */
export const POST = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.hrisCompensation);
  const { payroll_detail_id } = await readJson(request, notifySchema);
  return NextResponse.json(await notifyPayslip(await createServerPgClient(), payroll_detail_id));
}, "hris/payslips/notify.POST");
