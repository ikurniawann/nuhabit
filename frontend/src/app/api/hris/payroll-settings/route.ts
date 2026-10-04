import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { assertPayrollSettingsWriter } from "@/lib/hris/payroll-settings-access";
import { readJson } from "@/lib/hris/workforce-route";
import { IAM } from "@/lib/iam/prefixes";
import { createServerPgClient } from "@/lib/pg/create-client";
import { parseInput, searchParamsOf } from "@/lib/payroll/request-input";
import {
  loadPayrollSettings,
  payrollSettingsPutSchema,
  savePayrollSettings,
} from "@/lib/payroll/settings";

const getQuerySchema = z.object({ tax_year: z.coerce.number().int().optional() });

/** GET /api/hris/payroll-settings?tax_year=2026: pengaturan + tax config tahun itu. */
export const GET = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.hrisCompensation);
  const { tax_year } = parseInput(getQuerySchema, searchParamsOf(request));
  const data = await loadPayrollSettings(
    await createServerPgClient(),
    tax_year || new Date().getFullYear()
  );
  return NextResponse.json({ data });
}, "hris/payroll-settings.GET");

/** PUT /api/hris/payroll-settings: upsert pengaturan dan/atau tax config per tahun. */
export const PUT = apiHandler(async (request: NextRequest) => {
  assertPayrollSettingsWriter(await requireIamMenuPrefix(IAM.hrisCompensation));
  const input = await readJson(request, payrollSettingsPutSchema);
  if (!input.settings && !input.tax_config) {
    throw ApiError.badRequest("Tidak ada perubahan yang dikirim");
  }
  const data = await savePayrollSettings(await createServerPgClient(), input);
  return NextResponse.json({ data, message: "Pengaturan payroll tersimpan" });
}, "hris/payroll-settings.PUT");
