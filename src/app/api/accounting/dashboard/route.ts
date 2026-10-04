import { NextRequest, NextResponse } from "next/server";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { getApiUserScope } from "@/lib/api/scope";
import { accountingCompanyId } from "@/lib/accounting/company-scope";
import { getAccountingDashboard } from "@/lib/accounting/dashboard-store";

export const GET = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.accounting);
  const companyId = accountingCompanyId(await getApiUserScope());
  if (!companyId) return NextResponse.json({ data: null });

  const sp = request.nextUrl.searchParams;
  const asOf = sp.get("as_of")?.trim() || new Date().toISOString().slice(0, 10);
  const dateFrom = sp.get("date_from")?.trim() || `${asOf.slice(0, 4)}-01-01`;
  const dateTo = sp.get("date_to")?.trim() || asOf;
  const data = await getAccountingDashboard(companyId, { asOf, dateFrom, dateTo });
  return NextResponse.json({ data });
}, "GET /api/accounting/dashboard");
