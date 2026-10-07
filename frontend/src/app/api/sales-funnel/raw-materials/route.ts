import { NextRequest } from "next/server";
import { ApiError, successResponse } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { checkRateLimit } from "@/lib/rate-limit";
import { searchRawMaterials } from "@/lib/sales-funnel/catalog-server";
import { requireSalesFunnelUser, requireSalesScope } from "@/lib/sales-funnel/server";

/** Pencarian bahan baku untuk editor resep (Fase F3) — bidang minimal, difilter scope. */
export const GET = apiHandler(async (request: NextRequest) => {
  const user = await requireSalesFunnelUser();
  if (!checkRateLimit(`sales-funnel-raw-materials:${user.id}`, 60).allowed) {
    throw new ApiError(429, "Terlalu banyak pencarian — coba lagi sebentar");
  }
  const scope = await requireSalesScope(user);
  const q = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  return successResponse(await searchRawMaterials(q, scope));
}, "sales-funnel.raw-materials.GET");
