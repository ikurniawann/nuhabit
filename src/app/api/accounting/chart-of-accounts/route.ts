import { NextRequest, NextResponse } from "next/server";
import { requireIamMenuPrefix, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { getApiUserScope } from "@/lib/api/scope";
import { accountingCompanyId, requireAccountingCompanyId } from "@/lib/accounting/company-scope";
import { createChartOfAccount, listChartOfAccounts } from "@/lib/accounting/coa-store";
import { chartOfAccountPayloadSchema } from "@/lib/accounting/schemas";

export const GET = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.accounting);
  const companyId = accountingCompanyId(await getApiUserScope());
  if (!companyId) return NextResponse.json({ data: [] });
  const data = await listChartOfAccounts(companyId, request.nextUrl.searchParams);
  return NextResponse.json({ data });
}, "GET /api/accounting/chart-of-accounts");

export const POST = apiHandler(async (request: NextRequest) => {
  const user = await requireIamMenuPrefix(IAM.accounting);
  const body = await validateBody(request, chartOfAccountPayloadSchema);
  const scope = await getApiUserScope();
  const companyId = requireAccountingCompanyId(scope);
  const data = await createChartOfAccount({ userId: user.id, companyId, scope, body });
  return NextResponse.json({ data, message: "Akun berhasil ditambahkan" }, { status: 201 });
}, "POST /api/accounting/chart-of-accounts");
