import { NextRequest, NextResponse } from "next/server";
import { requireIamMenuPrefix, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { getApiUserScope } from "@/lib/api/scope";
import { assertRecordInScope } from "@/lib/accounting/route-helpers";
import { beginningBalancePayloadSchema } from "@/lib/accounting/schemas";
import {
  getBeginningBalanceSuggestion,
  saveBeginningBalance,
} from "@/lib/accounting/beginning-balance-store";
import { getFiscalYear } from "@/lib/accounting/fiscal-year-store";

type RouteContext = { params: Promise<{ id: string }> };

const NOT_FOUND = "Fiscal year tidak ditemukan";
const OUT_OF_SCOPE = "Fiscal year di luar scope";

export const GET = apiHandler(async (_request: NextRequest, { params }: RouteContext) => {
  await requireIamMenuPrefix(IAM.accounting);
  const { id } = await params;
  assertRecordInScope(await getFiscalYear(id), await getApiUserScope(), {
    notFound: NOT_FOUND,
    outOfScope: OUT_OF_SCOPE,
  });
  const data = await getBeginningBalanceSuggestion(id);
  return NextResponse.json({ data });
}, "GET /api/accounting/fiscal-years/[id]/beginning-balance");

export const POST = apiHandler(async (request: NextRequest, { params }: RouteContext) => {
  const user = await requireIamMenuPrefix(IAM.accounting);
  const { id } = await params;
  const body = await validateBody(request, beginningBalancePayloadSchema);
  assertRecordInScope(await getFiscalYear(id), await getApiUserScope(), {
    notFound: NOT_FOUND,
    outOfScope: OUT_OF_SCOPE,
    global: "Tidak dapat mengubah fiscal year global",
  });
  const result = await saveBeginningBalance({
    fiscalYearId: id,
    userId: user.id,
    payload: {
      retained_earnings_account_id: body.retained_earnings_account_id ?? null,
      lines: body.lines,
      post: body.post ?? false,
    },
  });
  return NextResponse.json({
    data: result,
    message: body.post
      ? "Beginning balance berhasil diposting"
      : "Beginning balance draft berhasil disimpan",
  });
}, "POST /api/accounting/fiscal-years/[id]/beginning-balance");
