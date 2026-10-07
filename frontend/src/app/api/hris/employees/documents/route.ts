import { NextRequest, NextResponse } from "next/server";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { requireEmployeeAccess } from "@/lib/hris/employee-access";
import { employeeDocumentCreateSchema } from "@/lib/hris/employee-document-schema";
import { createEmployeeDocument, listEmployeeDocuments } from "@/lib/hris/employees-records";
import { readJson } from "@/lib/hris/workforce-route";

/**
 * GET  /api/hris/employees/documents?employee_id= — pengelola karyawan atau
 *      karyawan pemilik dokumen.
 * POST /api/hris/employees/documents — catat dokumen setelah file diunggah
 *      (khusus menu kepegawaian, sama dengan DELETE/PATCH di [doc_id]).
 */

export const GET = apiHandler(async (request: NextRequest) => {
  const employeeId = request.nextUrl.searchParams.get("employee_id");
  if (!employeeId) throw ApiError.badRequest("employee_id diperlukan");
  await requireEmployeeAccess(employeeId);
  return NextResponse.json({ data: await listEmployeeDocuments(employeeId) });
}, "hris/employees/documents GET");

export const POST = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.hrisKepegawaian);
  const input = await readJson(request, employeeDocumentCreateSchema);
  const data = await createEmployeeDocument(input);
  return NextResponse.json({ data, message: "Dokumen berhasil disimpan" }, { status: 201 });
}, "hris/employees/documents POST");
