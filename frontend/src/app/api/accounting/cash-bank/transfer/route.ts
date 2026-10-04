import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireIamMenuPrefix, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { getApiUserScope } from "@/lib/api/scope";
import { requireAccountingCompanyId } from "@/lib/accounting/company-scope";
import { createCashTransfer, listCashTransfers } from "@/lib/accounting/cash-bank-store";

const createSchema = z.object({
  entry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount: z.number().positive(),
  from_account_id: z.string().uuid(),
  to_account_id: z.string().uuid(),
  description: z.string().trim().max(300).optional().nullable(),
  memo: z.string().trim().max(200).optional().nullable(),
});

export const GET = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.accounting);
  const companyId = requireAccountingCompanyId(await getApiUserScope());
  const sp = request.nextUrl.searchParams;
  const result = await listCashTransfers({
    companyId,
    search: sp.get("search") || undefined,
    dateFrom: sp.get("date_from") || undefined,
    dateTo: sp.get("date_to") || undefined,
    limit: Number(sp.get("limit") || 50),
    offset: Number(sp.get("offset") || 0),
  });
  return NextResponse.json({ success: true, data: result.rows, meta: { total: result.total } });
}, "GET /api/accounting/cash-bank/transfer");

export const POST = apiHandler(async (request: NextRequest) => {
  const user = await requireIamMenuPrefix(IAM.accounting);
  const companyId = requireAccountingCompanyId(await getApiUserScope());
  const body = await validateBody(request, createSchema);
  // Store menolak akun asal = tujuan dengan 400.
  const data = await createCashTransfer({
    userId: user.id,
    companyId,
    entryDate: body.entry_date,
    amount: body.amount,
    fromAccountId: body.from_account_id,
    toAccountId: body.to_account_id,
    description: body.description,
    memo: body.memo,
  });
  return NextResponse.json(
    { success: true, data, message: "Transfer berhasil dicatat & diposting" },
    { status: 201 }
  );
}, "POST /api/accounting/cash-bank/transfer");
