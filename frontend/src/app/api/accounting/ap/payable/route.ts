import { NextResponse } from "next/server";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { getApiUserScope } from "@/lib/api/scope";
import { requireAccountingCompanyId } from "@/lib/accounting/company-scope";
import { listApPayableRegister } from "@/lib/accounting/ap-store";

export const GET = apiHandler(async () => {
  await requireIamMenuPrefix(IAM.accounting);
  const companyId = requireAccountingCompanyId(await getApiUserScope());
  const rows = await listApPayableRegister({ companyId });
  return NextResponse.json({ success: true, data: rows });
}, "GET /api/accounting/ap/payable");
