import { NextRequest } from "next/server";
import { successResponse, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { requireAccessibleLead } from "@/lib/sales-funnel/access";
import { linkCustomerSchema, linkLeadCustomer, unlinkLeadCustomer } from "@/lib/sales-funnel/leads-server";
import { requireSalesFunnelUser } from "@/lib/sales-funnel/server";

type Params = { params: Promise<{ id: string }> };

/** Fase D: tautkan PIC lead ke member loyalty (existing atau dibuat dari data PIC). */
export const POST = apiHandler(async (request: NextRequest, { params }: Params) => {
  const user = await requireSalesFunnelUser();
  const { id } = await params;
  await requireAccessibleLead(id, user);
  const body = await validateBody(request, linkCustomerSchema);
  const customerId = await linkLeadCustomer(id, body);
  return successResponse({ customer_id: customerId }, "PIC tertaut ke member loyalty");
}, "sales-funnel.leads.link-customer.POST");

export const DELETE = apiHandler(async (_request: NextRequest, { params }: Params) => {
  const user = await requireSalesFunnelUser();
  const { id } = await params;
  await requireAccessibleLead(id, user);
  await unlinkLeadCustomer(id);
  return successResponse({ customer_id: null }, "Tautan member dilepas");
}, "sales-funnel.leads.link-customer.DELETE");
