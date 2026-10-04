import { NextRequest, NextResponse } from "next/server";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { getApiUserScope } from "@/lib/api/scope";
import { requireAccountingCompanyId } from "@/lib/accounting/company-scope";
import { listArInvoices, syncArFromOpenSalesInvoices } from "@/lib/accounting/ar-store";
import { parseInvoiceListQuery } from "@/lib/accounting/route-helpers";

export const GET = apiHandler(async (request: NextRequest) => {
  const user = await requireIamMenuPrefix(IAM.accounting);
  const companyId = requireAccountingCompanyId(await getApiUserScope());
  // Lazy sync terkirim B2B → AR
  await syncArFromOpenSalesInvoices({ companyId, userId: user.id, limit: 30 });
  const result = await listArInvoices({
    companyId,
    ...parseInvoiceListQuery(request.nextUrl.searchParams),
  });
  return NextResponse.json({ success: true, data: result.rows, meta: { total: result.total } });
}, "GET /api/accounting/ar/invoices");
