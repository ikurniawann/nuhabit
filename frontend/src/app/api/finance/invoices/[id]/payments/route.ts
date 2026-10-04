import { NextRequest, NextResponse } from "next/server";
import { successResponse } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { listInvoicePayments } from "@/lib/finance/invoices";
import { requireFinanceUser } from "@/lib/finance/server";

type RouteContext = { params: Promise<{ id: string }> };

export const GET = apiHandler(async (_request: NextRequest, { params }: RouteContext) => {
  const user = await requireFinanceUser();
  const { id } = await params;
  return successResponse(await listInvoicePayments(id, user));
}, "GET /api/finance/invoices/[id]/payments");

/** Deprecated: penerimaan piutang pindah ke Accounting AR Receipt. */
export const POST = apiHandler(async () => {
  await requireFinanceUser();
  return NextResponse.json(
    {
      success: false,
      error:
        "Penerimaan piutang dipindah ke Accounting → Accounts Receivable → Receipt. Gunakan /dashboard/accounting/receivable/receipts",
      redirect: "/dashboard/accounting/receivable/receipts",
    },
    { status: 410 }
  );
}, "POST /api/finance/invoices/[id]/payments");
