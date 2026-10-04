import { NextRequest } from "next/server";
import { noContentResponse, successResponse, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { requireAccessibleLead } from "@/lib/sales-funnel/access";
import { getLeadDetail, softDeleteLead, updateLead, updateLeadSchema } from "@/lib/sales-funnel/leads-server";
import { requireSalesFunnelUser } from "@/lib/sales-funnel/server";

type Params = { params: Promise<{ id: string }> };

/** Detail 360° instansi (EPIC-022 Fase D). */
export const GET = apiHandler(async (_request: NextRequest, { params }: Params) => {
  const user = await requireSalesFunnelUser();
  const { id } = await params;
  await requireAccessibleLead(id, user);
  return successResponse(await getLeadDetail(id));
}, "sales-funnel.leads.detail.GET");

export const PATCH = apiHandler(async (request: NextRequest, { params }: Params) => {
  const user = await requireSalesFunnelUser();
  const { id } = await params;
  const lead = await requireAccessibleLead(id, user);
  const body = await validateBody(request, updateLeadSchema);
  return successResponse(await updateLead(user, lead, body), "Lead diperbarui");
}, "sales-funnel.leads.PATCH");

export const DELETE = apiHandler(async (_request: NextRequest, { params }: Params) => {
  const user = await requireSalesFunnelUser();
  const { id } = await params;
  await requireAccessibleLead(id, user);
  await softDeleteLead(id);
  return noContentResponse();
}, "sales-funnel.leads.DELETE");
