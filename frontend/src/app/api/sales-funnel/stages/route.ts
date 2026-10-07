import { NextRequest } from "next/server";
import { createdResponse, successResponse, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { createStage, createStageSchema, listStages } from "@/lib/sales-funnel/pipelines-server";
import { requireRole, requireSalesFunnelUser } from "@/lib/sales-funnel/server";

export const GET = apiHandler(async (request: NextRequest) => {
  const user = await requireSalesFunnelUser();
  const searchParams = request.nextUrl.searchParams;
  // Tahap nonaktif hanya relevan untuk layar konfigurasi (super_admin);
  // kanban semua role cukup tahap aktif.
  const includeInactive = user.role === "super_admin" && searchParams.get("all") === "1";
  return successResponse(await listStages(searchParams.get("pipeline_id"), includeInactive));
}, "sales-funnel.stages.GET");

// EPIC-050 Fase 3: tambah tahap ke pipeline (admin/super_admin)
export const POST = apiHandler(async (request: NextRequest) => {
  const user = await requireSalesFunnelUser();
  requireRole(user, ["super_admin", "admin"], "Hanya admin/super admin");
  const body = await validateBody(request, createStageSchema);
  return createdResponse(await createStage(body), "Tahap ditambahkan");
}, "sales-funnel.stages.POST");
