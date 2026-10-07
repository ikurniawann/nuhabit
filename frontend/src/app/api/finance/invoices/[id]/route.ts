import { NextRequest } from "next/server";
import { z } from "zod";
import { successResponse, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { getFinanceInvoiceDetail, reviseFinanceInvoice } from "@/lib/finance/invoices";
import { requireFinanceUser } from "@/lib/finance/server";
import { isValidCalendarDate } from "@/lib/sales-funnel/server";

// EPIC-025 — detail invoice utk Finance (acuan quotation/termin jelas) +
// revisi field (label/nominal/jatuh tempo/catatan).

const reviseSchema = z.object({
  label: z.string().trim().min(1).max(150),
  amount: z.number().positive().max(999_999_999_999),
  due_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine(isValidCalendarDate, { message: "Tanggal tidak valid" })
    .optional()
    .nullable()
    .or(z.literal("")),
  note: z.string().trim().max(300).optional().nullable(),
});

type RouteContext = { params: Promise<{ id: string }> };

export const GET = apiHandler(async (_request: NextRequest, { params }: RouteContext) => {
  const user = await requireFinanceUser();
  const { id } = await params;
  return successResponse(await getFinanceInvoiceDetail(id, user));
}, "GET /api/finance/invoices/[id]");

export const PATCH = apiHandler(async (request: NextRequest, { params }: RouteContext) => {
  const user = await requireFinanceUser();
  const { id } = await params;
  const body = await validateBody(request, reviseSchema);
  const row = await reviseFinanceInvoice(id, user, body);
  return successResponse(row, `Invoice ${row.invoice_number} direvisi`);
}, "PATCH /api/finance/invoices/[id]");
