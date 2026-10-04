import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireIamMenuPrefix, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { getApiUserScope } from "@/lib/api/scope";
import { requireAccountingCompanyId } from "@/lib/accounting/company-scope";
import { AP_PAYMENT_METHODS } from "@/lib/accounting/ap-types";
import { listApPayments, recordApPayment } from "@/lib/accounting/ap-store";
import { rethrowAccountingPostError } from "@/lib/accounting/journal-mapping-posting";
import { createPgClient } from "@/lib/pg/create-client";
import { recordAuditAfterCommit, requestMeta } from "@/lib/audit";

const createSchema = z.object({
  invoice_id: z.string().uuid(),
  amount: z.number().positive(),
  payment_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  method: z.enum(AP_PAYMENT_METHODS).optional(),
  reference_number: z.string().max(120).optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
});

export const GET = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.accounting);
  const companyId = requireAccountingCompanyId(await getApiUserScope());
  const sp = request.nextUrl.searchParams;
  const result = await listApPayments({
    companyId,
    search: sp.get("search") || undefined,
    limit: Number(sp.get("limit") || 20),
    offset: Number(sp.get("offset") || 0),
  });
  return NextResponse.json({ success: true, data: result.rows, meta: { total: result.total } });
}, "GET /api/accounting/ap/payments");

export const POST = apiHandler(async (request: NextRequest) => {
  const user = await requireIamMenuPrefix(IAM.accounting);
  requireAccountingCompanyId(await getApiUserScope());
  const body = await validateBody(request, createSchema);

  const result = await recordApPayment({
    db: createPgClient(),
    userId: user.id,
    invoiceId: body.invoice_id,
    amount: body.amount,
    paymentDate: body.payment_date,
    method: body.method,
    referenceNumber: body.reference_number,
    notes: body.notes,
  }).catch(rethrowAccountingPostError);

  await recordAuditAfterCommit({
    actor: { id: user.id, name: user.full_name },
    action: "ap_payment.create",
    entity: "ap_payment",
    entityId: result.payment.id,
    entityLabel: result.payment.payment_no,
    after: {
      status: result.payment.status,
      amount: result.payment.amount,
      invoice_id: body.invoice_id,
      method: result.payment.method,
      payment_date: result.payment.payment_date,
      vendor_payment_id: result.payment.vendor_payment_id,
    },
    ...requestMeta(request),
  });

  const base = "Pembayaran AP berhasil dicatat";
  return NextResponse.json(
    {
      success: true,
      data: result.payment,
      invoice: result.invoice,
      message: result.note ? `${base} (${result.note})` : base,
    },
    { status: 201 }
  );
}, "POST /api/accounting/ap/payments");
