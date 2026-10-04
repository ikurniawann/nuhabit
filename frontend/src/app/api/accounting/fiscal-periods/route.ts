import { NextRequest, NextResponse } from "next/server";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { getApiUserScope } from "@/lib/api/scope";
import { requireAccountingCompanyId } from "@/lib/accounting/company-scope";
import { listAccountingPeriods } from "@/lib/accounting/fiscal";

export const GET = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.accounting);
  const companyId = requireAccountingCompanyId(await getApiUserScope());
  const sp = request.nextUrl.searchParams;
  const statusParam = sp.get("status");
  const data = await listAccountingPeriods({
    companyId,
    fiscalYearId: sp.get("fiscal_year_id") || undefined,
    status: statusParam === "OPEN" || statusParam === "CLOSED" ? statusParam : undefined,
    search: sp.get("search") || undefined,
  });
  return NextResponse.json({ success: true, data });
}, "GET /api/accounting/fiscal-periods");
