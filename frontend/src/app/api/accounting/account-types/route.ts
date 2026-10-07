import { NextRequest, NextResponse } from "next/server";
import { requireIamMenuPrefix, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { createAccountType, listAccountTypes } from "@/lib/accounting/account-type-store";
import { accountTypePayloadSchema } from "@/lib/accounting/schemas";

export const GET = apiHandler(async () => {
  await requireIamMenuPrefix(IAM.accounting);
  return NextResponse.json({ data: await listAccountTypes() });
}, "GET /api/accounting/account-types");

export const POST = apiHandler(async (request: NextRequest) => {
  const user = await requireIamMenuPrefix(IAM.accounting);
  const body = await validateBody(request, accountTypePayloadSchema);
  const data = await createAccountType(user.id, body);
  return NextResponse.json({ data, message: "Account type berhasil ditambahkan" }, { status: 201 });
}, "POST /api/accounting/account-types");
