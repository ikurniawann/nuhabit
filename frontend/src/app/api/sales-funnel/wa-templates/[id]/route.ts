import { NextRequest } from "next/server";
import { noContentResponse, successResponse, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import {
  deactivateWaTemplate,
  updateWaTemplate,
  updateWaTemplateSchema,
} from "@/lib/sales-funnel/catalog-server";
import { requireRole, requireSalesFunnelUser } from "@/lib/sales-funnel/server";

type Params = { params: Promise<{ id: string }> };

export const PATCH = apiHandler(async (request: NextRequest, { params }: Params) => {
  requireRole(await requireSalesFunnelUser(), ["super_admin"]);
  const { id } = await params;
  const body = await validateBody(request, updateWaTemplateSchema);
  return successResponse(await updateWaTemplate(id, body), "Template diperbarui");
}, "sales-funnel.wa-templates.PATCH");

export const DELETE = apiHandler(async (_request: NextRequest, { params }: Params) => {
  requireRole(await requireSalesFunnelUser(), ["super_admin"]);
  const { id } = await params;
  await deactivateWaTemplate(id);
  return noContentResponse();
}, "sales-funnel.wa-templates.DELETE");
