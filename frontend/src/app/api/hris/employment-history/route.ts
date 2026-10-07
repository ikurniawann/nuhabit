import { NextRequest, NextResponse } from "next/server";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { requireEmployeeAccess } from "@/lib/hris/employee-access";
import {
  createEmploymentHistory,
  employmentHistoryCreateSchema,
  listEmploymentHistory,
} from "@/lib/hris/employees-records";
import { readJson } from "@/lib/hris/workforce-route";

/**
 * GET  /api/hris/employment-history?employee_id= — pengelola karyawan atau
 *      karyawan itu sendiri.
 * POST /api/hris/employment-history — catat promosi/mutasi (menu kepegawaian).
 */

export const GET = apiHandler(async (request: NextRequest) => {
  const employeeId = request.nextUrl.searchParams.get("employee_id");
  if (!employeeId) throw ApiError.badRequest("employee_id diperlukan");
  await requireEmployeeAccess(employeeId);
  return NextResponse.json({ data: await listEmploymentHistory(employeeId) });
}, "hris/employment-history GET");

export const POST = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.hrisKepegawaian);
  const input = await readJson(request, employmentHistoryCreateSchema);
  const data = await createEmploymentHistory(input);
  return NextResponse.json({ data, message: "Riwayat kerja berhasil disimpan" }, { status: 201 });
}, "hris/employment-history POST");
