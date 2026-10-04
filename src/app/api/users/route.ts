import { NextRequest, NextResponse } from "next/server";
import { validateBody, requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { parseUserListQuery } from "@/lib/hris/users-list-query";
import { rethrowUserServiceError } from "@/lib/hris/users-service-errors";
import { createUserEmployee, listUserEmployees } from "@/lib/users/user-service";
import { createUserEmployeeSchema } from "@/lib/users/schemas";

export const GET = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.settingsUsers);
  const query = parseUserListQuery(request.nextUrl.searchParams);
  return NextResponse.json(await listUserEmployees(query));
}, "api/users");

export const POST = apiHandler(async (request: NextRequest) => {
  const actor = await requireIamMenuPrefix(IAM.settingsUsers);
  const body = await validateBody(request, createUserEmployeeSchema);
  const data = await createUserEmployee(actor.id, body).catch(rethrowUserServiceError);
  return NextResponse.json({ data, message: "Employee created successfully" }, { status: 201 });
}, "api/users");
