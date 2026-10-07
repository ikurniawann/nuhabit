import { NextRequest } from "next/server";
import { noContentResponse, successResponse, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import {
  deleteDashboard,
  loadDashboardWidgets,
  patchDashboardSchema,
  requireDashboard,
  updateDashboard,
} from "@/lib/crm/dashboards-server";
import { requireCrmScope } from "@/lib/crm/guards";

type Ctx = { params: Promise<{ id: string }> };

/** GET = dashboard + widget beserta hasil tiap report. */
export const GET = apiHandler(async (_request: NextRequest, { params }: Ctx) => {
  const { user, scope } = await requireCrmScope("reports");
  const { id } = await params;
  const dashboard = await requireDashboard(id, scope);
  return successResponse({ dashboard, widgets: await loadDashboardWidgets(id, user, scope) });
}, "crm.dashboards.[id].GET");

export const PATCH = apiHandler(async (request: NextRequest, { params }: Ctx) => {
  const { user, scope } = await requireCrmScope("reports");
  const { id } = await params;
  const dashboard = await requireDashboard(id, scope);
  const body = await validateBody(request, patchDashboardSchema);
  await updateDashboard(dashboard, user, scope, body);
  return successResponse({ id }, "Dashboard diperbarui");
}, "crm.dashboards.[id].PATCH");

export const DELETE = apiHandler(async (_request: NextRequest, { params }: Ctx) => {
  const { user, scope } = await requireCrmScope("reports");
  const { id } = await params;
  await deleteDashboard(await requireDashboard(id, scope), user);
  return noContentResponse();
}, "crm.dashboards.[id].DELETE");
