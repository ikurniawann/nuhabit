import { NextRequest, NextResponse } from "next/server";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { getApiUserScope } from "@/lib/api/scope";
import { accountingCompanyId } from "@/lib/accounting/company-scope";
import {
  getBalanceSheetReport,
  getCashFlowReport,
  getGeneralLedgerReport,
  getIncomeStatementReport,
  getTrialBalanceReport,
  listGeneralLedgerAccounts,
} from "@/lib/accounting/reports-store";

async function loadReport(report: string, companyId: string, sp: URLSearchParams) {
  const param = (key: string) => sp.get(key)?.trim() || undefined;
  const today = new Date().toISOString().slice(0, 10);
  const asOf = param("as_of") ?? today;
  const dateFrom = param("date_from") ?? `${today.slice(0, 4)}-01-01`;
  const dateTo = param("date_to") ?? today;

  switch (report) {
    case "trial-balance":
      return getTrialBalanceReport(companyId, asOf);
    case "balance-sheet":
      return getBalanceSheetReport(companyId, asOf);
    case "income-statement":
      return getIncomeStatementReport(companyId, dateFrom, dateTo);
    case "cash-flow":
      return getCashFlowReport(companyId, dateFrom, dateTo);
    case "general-ledger": {
      const accountId = param("account_id");
      if (!accountId) return listGeneralLedgerAccounts(companyId, asOf);
      const data = await getGeneralLedgerReport({
        companyId,
        accountId,
        dateFrom: param("date_from"),
        dateTo: param("date_to"),
      });
      if (!data) throw ApiError.notFound("Akun tidak ditemukan");
      return data;
    }
    default:
      throw ApiError.notFound("Report tidak ditemukan");
  }
}

export const GET = apiHandler(
  async (request: NextRequest, { params }: { params: Promise<{ report: string }> }) => {
    await requireIamMenuPrefix(IAM.accounting);
    const { report } = await params;
    const companyId = accountingCompanyId(await getApiUserScope());
    if (!companyId) return NextResponse.json({ data: null });
    const data = await loadReport(report, companyId, request.nextUrl.searchParams);
    return NextResponse.json({ data });
  },
  "GET /api/accounting/reports/[report]"
);
