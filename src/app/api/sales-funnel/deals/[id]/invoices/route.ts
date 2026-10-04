import { NextRequest } from "next/server";
import { ApiError, createdResponse, successResponse, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { INVOICE_VIEWER_ROLES, requireFinanceRole } from "@/lib/finance/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { requireAccessibleDeal } from "@/lib/sales-funnel/access";
import { createInvoice, createInvoiceSchema, loadDealInvoices } from "@/lib/sales-funnel/billing-server";

type Params = { params: Promise<{ id: string }> };

export const GET = apiHandler(async (_request: NextRequest, { params }: Params) => {
  const { error, user } = await requireFinanceRole(INVOICE_VIEWER_ROLES);
  if (error) return error;
  const { id } = await params;
  await requireAccessibleDeal(id, user);
  return successResponse(await loadDealInvoices(id));
}, "sales-funnel.deals.invoices.GET");

/** PENGAJUAN invoice (status 'diajukan') dari termin quotation acuan. */
export const POST = apiHandler(async (request: NextRequest, { params }: Params) => {
  const { error, user } = await requireFinanceRole(INVOICE_VIEWER_ROLES);
  if (error) return error;
  if (!checkRateLimit(`sales-invoice:${user.id}`, 20).allowed) {
    throw new ApiError(429, "Terlalu banyak pembuatan invoice — coba lagi sebentar");
  }
  const { id } = await params;
  const deal = await requireAccessibleDeal(id, user);
  const body = await validateBody(request, createInvoiceSchema);
  const row = await createInvoice(user, deal, body);
  return createdResponse(row, `Pengajuan invoice ${row?.invoice_number} terkirim ke Finance`);
}, "sales-funnel.deals.invoices.POST");
