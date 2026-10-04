import { NextRequest, NextResponse } from "next/server";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { createSalary, listSalaries, salaryCreateSchema } from "@/lib/hris/employee-salary-repo";
import { readJson } from "@/lib/hris/workforce-route";

/**
 * GET  /api/hris/employee-salary[?employee_id=] — daftar versi gaji
 * POST /api/hris/employee-salary — versi gaji baru (menonaktifkan versi aktif)
 * Khusus menu kompensasi: gaji adalah data finansial sensitif.
 */

export const GET = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.hrisCompensation);
  const employeeId = request.nextUrl.searchParams.get("employee_id");
  return NextResponse.json({ data: await listSalaries(employeeId) });
}, "hris/employee-salary GET");

export const POST = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.hrisCompensation);
  const input = await readJson(request, salaryCreateSchema);
  const data = await createSalary(input);
  return NextResponse.json({ data, message: "Salary structure berhasil dibuat" });
}, "hris/employee-salary POST");
