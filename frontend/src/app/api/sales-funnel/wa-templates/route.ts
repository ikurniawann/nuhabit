import { NextRequest } from "next/server";
import { createdResponse, successResponse, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { createWaTemplate, listWaTemplates, waTemplateSchema } from "@/lib/sales-funnel/catalog-server";
import { requireRole, requireSalesFunnelUser } from "@/lib/sales-funnel/server";

export const GET = apiHandler(async () => {
  await requireSalesFunnelUser();
  return successResponse(await listWaTemplates());
}, "sales-funnel.wa-templates.GET");

export const POST = apiHandler(async (request: NextRequest) => {
  const user = await requireSalesFunnelUser();
  requireRole(user, ["super_admin"]);
  const body = await validateBody(request, waTemplateSchema);
  return createdResponse(await createWaTemplate(body, user.id), "Template dibuat");
}, "sales-funnel.wa-templates.POST");
