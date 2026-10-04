import { NextRequest, NextResponse } from "next/server";
import { requireIamMenuPrefix, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { getApiUserScope } from "@/lib/api/scope";
import { softDeleteChartOfAccount, updateChartOfAccount } from "@/lib/accounting/coa-store";
import { chartOfAccountPayloadSchema } from "@/lib/accounting/schemas";

type RouteContext = { params: Promise<{ id: string }> };

export const PUT = apiHandler(async (request: NextRequest, { params }: RouteContext) => {
  const user = await requireIamMenuPrefix(IAM.accounting);
  const { id } = await params;
  const body = await validateBody(request, chartOfAccountPayloadSchema);
  const data = await updateChartOfAccount({
    id,
    userId: user.id,
    scope: await getApiUserScope(),
    body,
  });
  return NextResponse.json({ data, message: "Akun berhasil diperbarui" });
}, "PUT /api/accounting/chart-of-accounts/[id]");

export const DELETE = apiHandler(async (_request: NextRequest, { params }: RouteContext) => {
  const user = await requireIamMenuPrefix(IAM.accounting);
  const { id } = await params;
  await softDeleteChartOfAccount({ id, userId: user.id, scope: await getApiUserScope() });
  return NextResponse.json({ message: "Akun berhasil dihapus" });
}, "DELETE /api/accounting/chart-of-accounts/[id]");
