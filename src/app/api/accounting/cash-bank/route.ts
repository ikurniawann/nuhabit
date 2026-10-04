import { NextResponse } from "next/server";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { getApiUserScope } from "@/lib/api/scope";
import { accountingCompanyId } from "@/lib/accounting/company-scope";
import { listCashBankAccounts } from "@/lib/accounting/cash-bank-store";

export const GET = apiHandler(async () => {
  await requireIamMenuPrefix(IAM.accounting);
  const companyId = accountingCompanyId(await getApiUserScope());
  const data = companyId ? await listCashBankAccounts(companyId) : [];
  return NextResponse.json({ data });
}, "GET /api/accounting/cash-bank");
