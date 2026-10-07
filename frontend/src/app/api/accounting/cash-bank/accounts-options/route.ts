import { NextResponse } from "next/server";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { getApiUserScope } from "@/lib/api/scope";
import { requireAccountingCompanyId } from "@/lib/accounting/company-scope";
import { listPostableAccounts } from "@/lib/accounting/cash-bank-store";

export const GET = apiHandler(async () => {
  await requireIamMenuPrefix(IAM.accounting);
  const companyId = requireAccountingCompanyId(await getApiUserScope());
  const data = await listPostableAccounts(companyId);
  return NextResponse.json({ success: true, data });
}, "GET /api/accounting/cash-bank/accounts-options");
