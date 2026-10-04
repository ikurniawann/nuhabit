import { NextRequest } from "next/server";
import { createdResponse, paginatedResponse, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { contactSchema } from "@/lib/sales-funnel/accounts";
import { createContact, listContacts } from "@/lib/sales-funnel/contacts-server";
import { requireSalesFunnelUser, requireSalesScope } from "@/lib/sales-funnel/server";

export const GET = apiHandler(async (request: NextRequest) => {
  const user = await requireSalesFunnelUser();
  const scope = await requireSalesScope(user);
  const { data, meta } = await listContacts(user, scope, request.nextUrl.searchParams);
  return paginatedResponse(data, meta);
}, "sales-funnel.contacts.GET");

export const POST = apiHandler(async (request: NextRequest) => {
  const user = await requireSalesFunnelUser();
  const body = await validateBody(request, contactSchema);
  const scope = await requireSalesScope(user);
  return createdResponse(await createContact(user, scope, body), "Contact dibuat");
}, "sales-funnel.contacts.POST");
