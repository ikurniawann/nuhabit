import { NextRequest, NextResponse } from "next/server";
import { requireIamMenuPrefix, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { getApiUserScope } from "@/lib/api/scope";
import { accountingCompanyId, requireAccountingCompanyId } from "@/lib/accounting/company-scope";
import { resolveFiscalCoverage } from "@/lib/accounting/fiscal";
import { rethrowUniqueViolation } from "@/lib/accounting/route-helpers";
import { fiscalYearPayloadSchema, normalizeFiscalYearPayload } from "@/lib/accounting/schemas";
import { createFiscalYearRecord, listFiscalYears } from "@/lib/accounting/fiscal-year-store";

export const GET = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.accounting);
  const companyId = accountingCompanyId(await getApiUserScope());
  const sp = request.nextUrl.searchParams;

  if (sp.get("coverage") === "1") {
    const date = sp.get("date")?.trim() || new Date().toISOString().slice(0, 10);
    const data = companyId
      ? await resolveFiscalCoverage(date, companyId)
      : { date, ready: false, period: null, suggestion: null };
    return NextResponse.json({ data });
  }
  if (!companyId) return NextResponse.json({ data: [] });

  const data = await listFiscalYears({
    search: sp.get("search")?.trim() || undefined,
    isActive: sp.get("is_active") || undefined,
    companyScopeOr: `company_id.eq.${companyId}`,
  });
  return NextResponse.json({ data });
}, "GET /api/accounting/fiscal-years");

export const POST = apiHandler(async (request: NextRequest) => {
  const user = await requireIamMenuPrefix(IAM.accounting);
  const body = await validateBody(request, fiscalYearPayloadSchema);
  const companyId = requireAccountingCompanyId(await getApiUserScope());
  const data = await createFiscalYearRecord({
    userId: user.id,
    companyId,
    payload: normalizeFiscalYearPayload(body),
  }).catch(rethrowUniqueViolation("Kode fiscal year sudah dipakai"));
  return NextResponse.json({ data, message: "Fiscal year berhasil ditambahkan" }, { status: 201 });
}, "POST /api/accounting/fiscal-years");
