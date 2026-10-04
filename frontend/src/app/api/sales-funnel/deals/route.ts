import { NextRequest } from "next/server";
import { createdResponse, successResponse, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { createDealSchema } from "@/lib/sales-funnel/deals";
import { createDeal, listDeals } from "@/lib/sales-funnel/deals-server";
import { requireSalesFunnelUser, requireSalesScope } from "@/lib/sales-funnel/server";

export const GET = apiHandler(async (request: NextRequest) => {
  const user = await requireSalesFunnelUser();
  const scope = await requireSalesScope(user);
  return successResponse(await listDeals(user, scope, request.nextUrl.searchParams));
}, "sales-funnel.deals.GET");

export const POST = apiHandler(async (request: NextRequest) => {
  const user = await requireSalesFunnelUser();
  const body = await validateBody(request, createDealSchema);
  const scope = await requireSalesScope(user);
  const { row, orgName } = await createDeal(user, scope, body);
  return createdResponse(row, `Deal untuk ${orgName} berhasil dibuat`);
}, "sales-funnel.deals.POST");
