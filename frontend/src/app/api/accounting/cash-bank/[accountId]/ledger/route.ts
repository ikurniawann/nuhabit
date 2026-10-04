import { NextRequest, NextResponse } from "next/server";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { getApiUserScope } from "@/lib/api/scope";
import { requireAccountingCompanyId } from "@/lib/accounting/company-scope";
import { getCashBankLedger } from "@/lib/accounting/cash-bank-store";

export const GET = apiHandler(
  async (request: NextRequest, { params }: { params: Promise<{ accountId: string }> }) => {
    await requireIamMenuPrefix(IAM.accounting);
    const { accountId } = await params;
    const companyId = requireAccountingCompanyId(
      await getApiUserScope(),
      "Akun Anda belum terikat company. Data Cash & Bank hanya untuk company user yang login."
    );
    const sp = request.nextUrl.searchParams;
    const data = await getCashBankLedger({
      companyId,
      accountId,
      dateFrom: sp.get("date_from")?.trim() || undefined,
      dateTo: sp.get("date_to")?.trim() || undefined,
    });
    if (!data) throw ApiError.notFound("Akun kas/bank tidak ditemukan");
    return NextResponse.json({ data });
  },
  "GET /api/accounting/cash-bank/[accountId]/ledger"
);
