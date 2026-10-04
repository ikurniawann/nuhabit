import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireIamMenuPrefix, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { getApiUserScope } from "@/lib/api/scope";
import { requireAccountingCompanyId } from "@/lib/accounting/company-scope";
import { createCashMovement, listCashMovements } from "@/lib/accounting/cash-bank-store";

const createSchema = z.object({
  entry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount: z.number().positive(),
  cash_account_id: z.string().uuid(),
  offset_account_id: z.string().uuid(),
  description: z.string().trim().max(300).optional().nullable(),
  memo: z.string().trim().max(200).optional().nullable(),
});

/** GET/POST Cash In dan Cash Out hanya beda `kind` dan label pesan. */
export function cashMovementHandlers(kind: "cash_in" | "cash_out") {
  const path = `/api/accounting/cash-bank/${kind.replace("_", "-")}`;
  const label = kind === "cash_in" ? "Cash In" : "Cash Out";

  const GET = apiHandler(async (request: NextRequest) => {
    await requireIamMenuPrefix(IAM.accounting);
    const companyId = requireAccountingCompanyId(await getApiUserScope());
    const sp = request.nextUrl.searchParams;
    const result = await listCashMovements({
      companyId,
      kind,
      search: sp.get("search") || undefined,
      dateFrom: sp.get("date_from") || undefined,
      dateTo: sp.get("date_to") || undefined,
      limit: Number(sp.get("limit") || 50),
      offset: Number(sp.get("offset") || 0),
    });
    return NextResponse.json({ success: true, data: result.rows, meta: { total: result.total } });
  }, `GET ${path}`);

  const POST = apiHandler(async (request: NextRequest) => {
    const user = await requireIamMenuPrefix(IAM.accounting);
    const companyId = requireAccountingCompanyId(await getApiUserScope());
    const body = await validateBody(request, createSchema);
    const data = await createCashMovement({
      userId: user.id,
      companyId,
      kind,
      entryDate: body.entry_date,
      amount: body.amount,
      cashAccountId: body.cash_account_id,
      offsetAccountId: body.offset_account_id,
      description: body.description,
      memo: body.memo,
    });
    return NextResponse.json(
      { success: true, data, message: `${label} berhasil dicatat & diposting` },
      { status: 201 }
    );
  }, `POST ${path}`);

  return { GET, POST };
}
