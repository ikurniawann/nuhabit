import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { getApiUserScope } from "@/lib/api/scope";
import { ACCOUNTING_API_ROLES } from "@/lib/accounting/coa-types";
import { requireAccountingCompanyId } from "@/lib/accounting/company-scope";
import { AP_PAYMENT_METHODS } from "@/lib/accounting/ap-types";
import { listApPayments, recordApPayment } from "@/lib/accounting/ap-store";
import { createPgClient } from "@/lib/pg/create-client";
import { AccountingPostError } from "@/lib/accounting/journal-mapping-posting";
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

function errMsg(error: unknown) {
  return error instanceof Error ? error.message : "Internal server error";
}

export async function GET(request: NextRequest) {
  try {
    await requireIamMenuPrefix(IAM.accounting);
    const scope = await getApiUserScope();
    const companyId = requireAccountingCompanyId(scope);
    const sp = request.nextUrl.searchParams;
    const result = await listApPayments({
      companyId,
      search: sp.get("search") || undefined,
      limit: Number(sp.get("limit") || 20),
      offset: Number(sp.get("offset") || 0),
    });
    return NextResponse.json({
      success: true,
      data: result.rows,
      meta: { total: result.total },
    });
  } catch (error: unknown) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("GET /api/accounting/ap/payments", error);
    return NextResponse.json(
      { success: false, message: errMsg(error) },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireIamMenuPrefix(IAM.accounting);
    const scope = await getApiUserScope();
    requireAccountingCompanyId(scope);
    const body = createSchema.parse(await request.json());
    const db = createPgClient();

    const result = await recordApPayment({
      db,
      userId: user.id,
      invoiceId: body.invoice_id,
      amount: body.amount,
      paymentDate: body.payment_date,
      method: body.method,
      referenceNumber: body.reference_number,
      notes: body.notes,
    });

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
  } catch (error: unknown) {
    if (error instanceof ApiError) return error.toResponse();
    if (error instanceof AccountingPostError) {
      return NextResponse.json(
        { success: false, message: error.message },
        { status: 500 }
      );
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          success: false,
          message: "Validation failed",
          errors: error.flatten().fieldErrors,
        },
        { status: 400 }
      );
    }
    const message = errMsg(error);
    const status = /melebihi|harus|tidak ditemukan|POSTED/i.test(message)
      ? 400
      : 500;
    console.error("POST /api/accounting/ap/payments", error);
    return NextResponse.json({ success: false, message }, { status });
  }
}
