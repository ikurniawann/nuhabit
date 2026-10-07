import { NextRequest } from "next/server";
import { createdResponse, successResponse, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { createDashboard, createDashboardSchema, listDashboards } from "@/lib/crm/dashboards-server";
import { requireCrmScope } from "@/lib/crm/guards";

/** EPIC-050 T-4.2 — daftar & buat dashboard CRM. */
export const GET = apiHandler(async () => {
  const { scope } = await requireCrmScope("reports");
  return successResponse(await listDashboards(scope));
}, "crm.dashboards.GET");

export const POST = apiHandler(async (request: NextRequest) => {
  const { user, scope } = await requireCrmScope("reports");
  const body = await validateBody(request, createDashboardSchema);
  return createdResponse(await createDashboard(user, scope, body), "Dashboard dibuat");
}, "crm.dashboards.POST");
