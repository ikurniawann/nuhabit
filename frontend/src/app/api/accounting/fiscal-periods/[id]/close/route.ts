import { NextRequest, NextResponse } from "next/server";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { getApiUserScope } from "@/lib/api/scope";
import { requireAccountingCompanyId } from "@/lib/accounting/company-scope";
import {
  assertFiscalPeriodInScope,
  closeFiscalPeriodById,
  getPeriodClosePreview,
} from "@/lib/accounting/fiscal";

type RouteContext = { params: Promise<{ id: string }> };

export const GET = apiHandler(async (_request: NextRequest, { params }: RouteContext) => {
  await requireIamMenuPrefix(IAM.accounting);
  const { id } = await params;
  const scope = await getApiUserScope();
  const companyId = requireAccountingCompanyId(scope);
  await assertFiscalPeriodInScope(id, scope);
  const data = await getPeriodClosePreview({ periodId: id, companyId });
  return NextResponse.json({ success: true, data });
}, "GET /api/accounting/fiscal-periods/[id]/close");

export const POST = apiHandler(async (_request: NextRequest, { params }: RouteContext) => {
  const user = await requireIamMenuPrefix(IAM.accounting);
  const { id } = await params;
  const scope = await getApiUserScope();
  const companyId = requireAccountingCompanyId(scope);
  await assertFiscalPeriodInScope(id, scope);
  const data = await closeFiscalPeriodById({ periodId: id, userId: user.id, companyId });
  return NextResponse.json({
    success: true,
    data,
    message: `Period ${data.name} berhasil ditutup`,
  });
}, "POST /api/accounting/fiscal-periods/[id]/close");
