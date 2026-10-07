import { NextRequest, NextResponse } from "next/server";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { getApiUserScope } from "@/lib/api/scope";
import { requireAccountingCompanyId } from "@/lib/accounting/company-scope";
import { importChartOfAccounts } from "@/lib/accounting/coa-import";

export const POST = apiHandler(async (request: NextRequest) => {
  const user = await requireIamMenuPrefix(IAM.accounting);
  const companyId = requireAccountingCompanyId(await getApiUserScope());

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw ApiError.badRequest("File Excel wajib diunggah");

  const result = await importChartOfAccounts({
    companyId,
    userId: user.id,
    file,
    mode: String(form.get("mode") || "preview"),
  });
  return NextResponse.json(result);
}, "POST /api/accounting/chart-of-accounts/import");
