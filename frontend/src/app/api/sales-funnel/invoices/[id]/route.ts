import { NextRequest } from "next/server";
import { noContentResponse, successResponse, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { INVOICE_VIEWER_ROLES, requireFinanceRole } from "@/lib/finance/server";
import {
  deleteInvoice,
  requireAccessibleInvoice,
  updateInvoiceSchema,
  updateInvoiceStatus,
} from "@/lib/sales-funnel/billing-server";

type Params = { params: Promise<{ id: string }> };

// EPIC-025 (Opsi B) — siklus dokumen invoice diproses FINANCE:
// diajukan/draft → terkirim (terbit+kirim), atau batal (tolak).
export const PATCH = apiHandler(async (request: NextRequest, { params }: Params) => {
  const { error, user } = await requireFinanceRole();
  if (error) return error;
  const { id } = await params;
  const invoice = await requireAccessibleInvoice(id, user);
  const { status } = await validateBody(request, updateInvoiceSchema);
  const { row, message } = await updateInvoiceStatus(user, invoice, status);
  return successResponse(row, message);
}, "sales-funnel.invoices.PATCH");

export const DELETE = apiHandler(async (_request: NextRequest, { params }: Params) => {
  const { error, user } = await requireFinanceRole(INVOICE_VIEWER_ROLES);
  if (error) return error;
  const { id } = await params;
  const invoice = await requireAccessibleInvoice(id, user);
  await deleteInvoice(user, invoice);
  return noContentResponse();
}, "sales-funnel.invoices.DELETE");
