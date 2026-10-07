import { NextRequest } from "next/server";
import { createdResponse, paginatedResponse, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { accountSchema } from "@/lib/sales-funnel/accounts";
import { createAccount, listAccounts } from "@/lib/sales-funnel/accounts-server";
import { requireSalesFunnelUser, requireSalesScope, requireSalesVenue } from "@/lib/sales-funnel/server";

export const GET = apiHandler(async (request: NextRequest) => {
  const user = await requireSalesFunnelUser();
  const scope = await requireSalesScope(user);
  const { data, meta } = await listAccounts(user, scope, request.nextUrl.searchParams);
  return paginatedResponse(data, meta);
}, "sales-funnel.accounts.GET");

export const POST = apiHandler(async (request: NextRequest) => {
  const user = await requireSalesFunnelUser();
  const body = await validateBody(request, accountSchema);
  const scope = await requireSalesScope(user);
  const venue = await requireSalesVenue(scope);
  return createdResponse(await createAccount(user, venue, body), "Account dibuat");
}, "sales-funnel.accounts.POST");
