import { NextRequest } from "next/server";
import { noContentResponse, successResponse, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { requireAccessibleContact } from "@/lib/sales-funnel/access";
import { updateContactSchema } from "@/lib/sales-funnel/accounts";
import { deleteContact, getContactDetail, updateContact } from "@/lib/sales-funnel/contacts-server";
import { requireSalesFunnelUser } from "@/lib/sales-funnel/server";

type Params = { params: Promise<{ id: string }> };

export const GET = apiHandler(async (_request: NextRequest, { params }: Params) => {
  const user = await requireSalesFunnelUser();
  const { id } = await params;
  await requireAccessibleContact(id, user);
  return successResponse(await getContactDetail(id));
}, "sales-funnel.contacts.detail.GET");

export const PATCH = apiHandler(async (request: NextRequest, { params }: Params) => {
  const user = await requireSalesFunnelUser();
  const { id } = await params;
  const contact = await requireAccessibleContact(id, user);
  const body = await validateBody(request, updateContactSchema);
  return successResponse(await updateContact(user, contact, body), "Contact diperbarui");
}, "sales-funnel.contacts.PATCH");

export const DELETE = apiHandler(async (_request: NextRequest, { params }: Params) => {
  const user = await requireSalesFunnelUser();
  const { id } = await params;
  await requireAccessibleContact(id, user);
  await deleteContact(id);
  return noContentResponse();
}, "sales-funnel.contacts.DELETE");
