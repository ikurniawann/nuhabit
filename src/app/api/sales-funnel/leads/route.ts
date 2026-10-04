import { NextRequest } from "next/server";
import { createdResponse, paginatedResponse, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { createLead, createLeadSchema, listLeads } from "@/lib/sales-funnel/leads-server";
import { requireSalesFunnelUser, requireSalesScope, requireSalesVenue } from "@/lib/sales-funnel/server";

export const GET = apiHandler(async (request: NextRequest) => {
  const user = await requireSalesFunnelUser();
  const scope = await requireSalesScope(user);
  const { data, meta } = await listLeads(user, scope, request.nextUrl.searchParams);
  return paginatedResponse(data, meta);
}, "sales-funnel.leads.GET");

export const POST = apiHandler(async (request: NextRequest) => {
  const user = await requireSalesFunnelUser();
  const body = await validateBody(request, createLeadSchema);
  const scope = await requireSalesScope(user);
  const venue = await requireSalesVenue(scope);
  return createdResponse(await createLead(user, venue, body), "Lead berhasil dibuat");
}, "sales-funnel.leads.POST");
