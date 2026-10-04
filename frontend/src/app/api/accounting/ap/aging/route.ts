import { NextRequest, NextResponse } from "next/server";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { getApiUserScope } from "@/lib/api/scope";
import { requireAccountingCompanyId } from "@/lib/accounting/company-scope";
import { listApAging } from "@/lib/accounting/ap-store";

export const GET = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.accounting);
  const companyId = requireAccountingCompanyId(await getApiUserScope());
  const asOf = request.nextUrl.searchParams.get("as_of") || undefined;
  const data = await listApAging({ companyId, asOf });
  return NextResponse.json({ success: true, data });
}, "GET /api/accounting/ap/aging");
