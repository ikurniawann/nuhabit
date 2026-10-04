import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireIamMenuPrefix, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { getApiUserScope } from "@/lib/api/scope";
import { requireAccountingCompanyId } from "@/lib/accounting/company-scope";
import { AR_RECEIPT_METHODS } from "@/lib/accounting/ar-types";
import { listArReceipts, recordArReceipt } from "@/lib/accounting/ar-store";
import { rethrowAccountingPostError } from "@/lib/accounting/journal-mapping-posting";

const createSchema = z.object({
  invoice_id: z.string().uuid(),
  amount: z.number().positive(),
  receipt_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  method: z.enum(AR_RECEIPT_METHODS).optional(),
  reference_number: z.string().max(120).optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
});

export const GET = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.accounting);
  const companyId = requireAccountingCompanyId(await getApiUserScope());
  const sp = request.nextUrl.searchParams;
  const result = await listArReceipts({
    companyId,
    search: sp.get("search") || undefined,
    limit: Number(sp.get("limit") || 20),
    offset: Number(sp.get("offset") || 0),
  });
  return NextResponse.json({ success: true, data: result.rows, meta: { total: result.total } });
}, "GET /api/accounting/ar/receipts");

export const POST = apiHandler(async (request: NextRequest) => {
  const user = await requireIamMenuPrefix(IAM.accounting);
  requireAccountingCompanyId(await getApiUserScope());
  const body = await validateBody(request, createSchema);
  const result = await recordArReceipt({
    userId: user.id,
    invoiceId: body.invoice_id,
    amount: body.amount,
    receiptDate: body.receipt_date,
    method: body.method,
    referenceNumber: body.reference_number,
    notes: body.notes,
  }).catch(rethrowAccountingPostError);
  const base = "Penerimaan AR berhasil dicatat";
  return NextResponse.json(
    {
      success: true,
      data: result.receipt,
      invoice: result.invoice,
      message: result.note ? `${base} (${result.note})` : base,
    },
    { status: 201 }
  );
}, "POST /api/accounting/ar/receipts");
