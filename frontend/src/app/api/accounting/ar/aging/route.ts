import { NextRequest, NextResponse } from "next/server";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { getApiUserScope } from "@/lib/api/scope";
import { requireAccountingCompanyId } from "@/lib/accounting/company-scope";
import { listArAging, syncArFromOpenSalesInvoices } from "@/lib/accounting/ar-store";

export const GET = apiHandler(async (request: NextRequest) => {
  const user = await requireIamMenuPrefix(IAM.accounting);
  const companyId = requireAccountingCompanyId(await getApiUserScope());
  await syncArFromOpenSalesInvoices({ companyId, userId: user.id, limit: 30 });
  const asOf = request.nextUrl.searchParams.get("as_of") || undefined;
  const data = await listArAging({ companyId, asOf });
  return NextResponse.json({ success: true, data });
}, "GET /api/accounting/ar/aging");
