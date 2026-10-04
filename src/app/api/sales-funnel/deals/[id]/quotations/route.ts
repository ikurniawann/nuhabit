import { NextRequest } from "next/server";
import { createdResponse, successResponse, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { requireAccessibleDeal } from "@/lib/sales-funnel/access";
import { quotationPayloadSchema } from "@/lib/sales-funnel/quotations";
import { createQuotation, listDealQuotations } from "@/lib/sales-funnel/quotations-server";
import { requireSalesFunnelUser } from "@/lib/sales-funnel/server";

type Params = { params: Promise<{ id: string }> };

/** Daftar quotation sebuah deal + baris itemnya (EPIC-022 Fase F1). */
export const GET = apiHandler(async (_request: NextRequest, { params }: Params) => {
  const user = await requireSalesFunnelUser();
  const { id } = await params;
  await requireAccessibleDeal(id, user);
  return successResponse(await listDealQuotations(id));
}, "sales-funnel.deals.quotations.GET");

/** Buat quotation baru — total dihitung server. */
export const POST = apiHandler(async (request: NextRequest, { params }: Params) => {
  const user = await requireSalesFunnelUser();
  const { id } = await params;
  const deal = await requireAccessibleDeal(id, user);
  const payload = await validateBody(request, quotationPayloadSchema);
  const row = await createQuotation(user, deal, payload);
  return createdResponse(row, `Quotation ${row.quote_number} dibuat`);
}, "sales-funnel.deals.quotations.POST");
