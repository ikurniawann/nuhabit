import { NextResponse, type NextRequest } from "next/server";
import { requireIamMenuPrefix, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { createEmploymentStatus, employmentStatusSchema, listEmploymentStatuses } from "@/lib/hris/master-data";

const READERS = [...IAM.hris, ...IAM.settingsUsers];

export const GET = apiHandler(async () => {
  await requireIamMenuPrefix(READERS);
  return NextResponse.json({ data: await listEmploymentStatuses() });
}, "master/employment-statuses");

export const POST = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.hrisMaster);
  const data = await createEmploymentStatus(await validateBody(request, employmentStatusSchema));
  return NextResponse.json({ data, message: "Status kepegawaian berhasil ditambahkan" }, { status: 201 });
}, "master/employment-statuses");
