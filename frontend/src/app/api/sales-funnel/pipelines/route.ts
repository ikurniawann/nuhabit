import { NextRequest } from "next/server";
import { createdResponse, successResponse, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { getApiUserScope } from "@/lib/api/scope";
import { createPipeline, createPipelineSchema, listPipelines } from "@/lib/sales-funnel/pipelines-server";
import { requireRole, requireSalesFunnelUser } from "@/lib/sales-funnel/server";

/** EPIC-050 T-3.1 — daftar pipeline + tahapnya (untuk tab kanban & form deal). */
export const GET = apiHandler(async (request: NextRequest) => {
  await requireSalesFunnelUser();
  const scope = await getApiUserScope();
  const includeInactive = request.nextUrl.searchParams.get("all") === "1";
  return successResponse(await listPipelines(scope?.companyId ?? null, includeInactive));
}, "sales-funnel.pipelines.GET");

export const POST = apiHandler(async (request: NextRequest) => {
  const user = await requireSalesFunnelUser();
  requireRole(user, ["super_admin", "admin"], "Hanya admin/super admin yang boleh membuat pipeline");
  const body = await validateBody(request, createPipelineSchema);
  const scope = await getApiUserScope();
  // super_admin tanpa company → pipeline global
  const companyId = user.role === "super_admin" && !scope?.companyId ? null : scope?.companyId ?? null;
  return createdResponse(await createPipeline(body, companyId), "Pipeline dibuat");
}, "sales-funnel.pipelines.POST");
