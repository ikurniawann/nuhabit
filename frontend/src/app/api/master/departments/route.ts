import { NextResponse, type NextRequest } from "next/server";
import { requireIamMenuPrefix, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { createDepartment, departmentSchema, listDepartments } from "@/lib/hris/master-data";

const READERS = [...IAM.hris, ...IAM.settingsUsers];

export const GET = apiHandler(async () => {
  await requireIamMenuPrefix(READERS);
  return NextResponse.json({ data: await listDepartments() });
}, "master/departments");

export const POST = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.hrisMaster);
  const data = await createDepartment(await validateBody(request, departmentSchema));
  return NextResponse.json({ data, message: "Departemen berhasil ditambahkan" }, { status: 201 });
}, "master/departments");
