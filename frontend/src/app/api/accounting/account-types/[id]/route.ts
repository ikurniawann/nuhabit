import { NextRequest, NextResponse } from "next/server";
import { requireIamMenuPrefix, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { deleteAccountType, updateAccountType } from "@/lib/accounting/account-type-store";
import { accountTypePayloadSchema } from "@/lib/accounting/schemas";

type RouteContext = { params: Promise<{ id: string }> };

export const PUT = apiHandler(async (request: NextRequest, { params }: RouteContext) => {
  const user = await requireIamMenuPrefix(IAM.accounting);
  const { id } = await params;
  const body = await validateBody(request, accountTypePayloadSchema);
  const data = await updateAccountType(id, user.id, body);
  return NextResponse.json({ data, message: "Account type berhasil diperbarui" });
}, "PUT /api/accounting/account-types/[id]");

export const DELETE = apiHandler(async (_request: NextRequest, { params }: RouteContext) => {
  await requireIamMenuPrefix(IAM.accounting);
  const { id } = await params;
  await deleteAccountType(id);
  return NextResponse.json({ message: "Account type berhasil dihapus" });
}, "DELETE /api/accounting/account-types/[id]");
