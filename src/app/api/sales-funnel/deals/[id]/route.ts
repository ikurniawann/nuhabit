import { NextRequest } from "next/server";
import { noContentResponse, successResponse, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { requireAccessibleDeal } from "@/lib/sales-funnel/access";
import { updateDealSchema } from "@/lib/sales-funnel/deals";
import { softDeleteDeal, updateDeal } from "@/lib/sales-funnel/deals-server";
import { requireSalesFunnelUser } from "@/lib/sales-funnel/server";

type Params = { params: Promise<{ id: string }> };

export const PATCH = apiHandler(async (request: NextRequest, { params }: Params) => {
  const user = await requireSalesFunnelUser();
  const { id } = await params;
  const deal = await requireAccessibleDeal(id, user);
  const body = await validateBody(request, updateDealSchema);
  return successResponse(await updateDeal(user, deal, body), "Deal diperbarui");
}, "sales-funnel.deals.PATCH");

export const DELETE = apiHandler(async (_request: NextRequest, { params }: Params) => {
  const user = await requireSalesFunnelUser();
  const { id } = await params;
  await requireAccessibleDeal(id, user);
  await softDeleteDeal(id);
  return noContentResponse();
}, "sales-funnel.deals.DELETE");
