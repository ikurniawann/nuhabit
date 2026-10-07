import { NextRequest } from "next/server";
import { successResponse, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { updateStage, updateStageSchema } from "@/lib/sales-funnel/pipelines-server";
import { requireRole, requireSalesFunnelUser } from "@/lib/sales-funnel/server";

type Params = { params: Promise<{ id: string }> };

export const PATCH = apiHandler(async (request: NextRequest, { params }: Params) => {
  const user = await requireSalesFunnelUser();
  // Konfigurasi tahap = wewenang Super Admin (keputusan owner EPIC-022)
  requireRole(user, ["super_admin"]);
  const { id } = await params;
  const body = await validateBody(request, updateStageSchema);
  return successResponse(await updateStage(id, body), "Tahap diperbarui");
}, "sales-funnel.stages.PATCH");
