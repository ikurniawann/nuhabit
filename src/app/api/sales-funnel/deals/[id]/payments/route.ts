import { NextRequest } from "next/server";
import { ApiError, createdResponse, successResponse, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { INVOICE_VIEWER_ROLES, requireFinanceRole } from "@/lib/finance/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { requireAccessibleDeal } from "@/lib/sales-funnel/access";
import { createPayment, createPaymentSchema, loadPaymentSummary } from "@/lib/sales-funnel/billing-server";

type Params = { params: Promise<{ id: string }> };

/** Sales boleh MELIHAT progress pelunasan; pencatatan hanya finance (Opsi B). */
export const GET = apiHandler(async (_request: NextRequest, { params }: Params) => {
  const { error, user } = await requireFinanceRole(INVOICE_VIEWER_ROLES);
  if (error) return error;
  const { id } = await params;
  await requireAccessibleDeal(id, user);
  return successResponse(await loadPaymentSummary(id));
}, "sales-funnel.deals.payments.GET");

export const POST = apiHandler(async (request: NextRequest, { params }: Params) => {
  // Pencatatan pembayaran = wewenang finance (EPIC-025 Opsi B)
  const { error, user } = await requireFinanceRole();
  if (error) return error;
  if (!checkRateLimit(`sales-payment:${user.id}`, 20).allowed) {
    throw new ApiError(429, "Terlalu banyak pencatatan — coba lagi sebentar");
  }
  const { id } = await params;
  const deal = await requireAccessibleDeal(id, user);
  const body = await validateBody(request, createPaymentSchema);
  return createdResponse(await createPayment(user, deal, body), "Pembayaran tercatat");
}, "sales-funnel.deals.payments.POST");
