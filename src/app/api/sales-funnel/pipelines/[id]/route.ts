import { NextRequest } from "next/server";
import { successResponse, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { updatePipeline, updatePipelineSchema } from "@/lib/sales-funnel/pipelines-server";
import { requireRole, requireSalesFunnelUser } from "@/lib/sales-funnel/server";

type Params = { params: Promise<{ id: string }> };

export const PATCH = apiHandler(async (request: NextRequest, { params }: Params) => {
  const user = await requireSalesFunnelUser();
  requireRole(user, ["super_admin", "admin"], "Hanya admin/super admin");
  const { id } = await params;
  const body = await validateBody(request, updatePipelineSchema);
  return successResponse(await updatePipeline(id, body), "Pipeline diperbarui");
}, "sales-funnel.pipelines.PATCH");
