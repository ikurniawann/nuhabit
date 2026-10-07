import { NextResponse } from "next/server";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { getApiUserScope } from "@/lib/api/scope";
import { requireAccountingCompanyId } from "@/lib/accounting/company-scope";
import { listArReceivable, syncArFromOpenSalesInvoices } from "@/lib/accounting/ar-store";

export const GET = apiHandler(async () => {
  const user = await requireIamMenuPrefix(IAM.accounting);
  const companyId = requireAccountingCompanyId(await getApiUserScope());
  await syncArFromOpenSalesInvoices({ companyId, userId: user.id, limit: 30 });
  const rows = await listArReceivable({ companyId });
  return NextResponse.json({ success: true, data: rows });
}, "GET /api/accounting/ar/receivable");
