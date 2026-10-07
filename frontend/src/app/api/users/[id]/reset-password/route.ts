import { NextRequest, NextResponse } from "next/server";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { resetEmployeeAppPassword } from "@/lib/hris/users-app-password";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export const POST = apiHandler(async (_request: NextRequest, { params }: RouteParams) => {
  await requireIamMenuPrefix(IAM.settingsUsers);
  const { id } = await params;
  const { message, tempPassword } = await resetEmployeeAppPassword(id);
  return NextResponse.json({ message, tempPassword });
}, "api/users/:id/reset-password");
