import { NextRequest, NextResponse } from "next/server";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { getApiUserScope } from "@/lib/api/scope";
import { requireAccountingCompanyId } from "@/lib/accounting/company-scope";
import { listApInvoices } from "@/lib/accounting/ap-store";
import { parseInvoiceListQuery } from "@/lib/accounting/route-helpers";

export const GET = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.accounting);
  const companyId = requireAccountingCompanyId(await getApiUserScope());
  const result = await listApInvoices({
    companyId,
    ...parseInvoiceListQuery(request.nextUrl.searchParams),
  });
  return NextResponse.json({ success: true, data: result.rows, meta: { total: result.total } });
}, "GET /api/accounting/ap/invoices");
