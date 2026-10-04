import { NextRequest, NextResponse } from "next/server";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import {
  EMPLOYEE_DIRECTORY_READERS,
  EMPLOYEE_RECORD_MANAGERS,
} from "@/lib/hris/employee-access";
import {
  createEmployee,
  employeeCreateSchema,
  listEmployeeDirectory,
  parseDirectoryParams,
} from "@/lib/hris/employees-repo";
import { readJson } from "@/lib/hris/workforce-route";

/**
 * GET  /api/hris/employees — direktori karyawan (kolom non-pribadi saja).
 *      Query: search, department_id, section_id, employment_status,
 *      is_active, page, limit, sort_by, sort_order.
 * POST /api/hris/employees — tambah karyawan (khusus pengelola).
 */

export const GET = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(EMPLOYEE_DIRECTORY_READERS);
  const params = parseDirectoryParams(request.nextUrl.searchParams);
  const { data, total } = await listEmployeeDirectory(params);
  return NextResponse.json({ data, total, page: params.page, per_page: params.limit });
}, "hris/employees GET");

export const POST = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(EMPLOYEE_RECORD_MANAGERS);
  const input = await readJson(request, employeeCreateSchema);
  const data = await createEmployee(input);
  return NextResponse.json({ data, message: "Karyawan berhasil ditambahkan" });
}, "hris/employees POST");
