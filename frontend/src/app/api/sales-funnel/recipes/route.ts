import { NextRequest } from "next/server";
import { ApiError, successResponse, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { getRecipe, putRecipeSchema, replaceRecipe } from "@/lib/sales-funnel/catalog-server";
import { requireRole, requireSalesFunnelUser } from "@/lib/sales-funnel/server";

/**
 * Resep sebuah produk — bahan baku per 1 unit/pax (Fase F3).
 * super_admin-only (temuan CRITICAL gate F3): join ke item.raw_materials
 * yang BER-tenant; realisasi menghitung server-side, sales tidak butuh BOM.
 */
export const GET = apiHandler(async (request: NextRequest) => {
  requireRole(await requireSalesFunnelUser(), ["super_admin"]);
  const productId = request.nextUrl.searchParams.get("product_id");
  if (!productId) throw ApiError.badRequest("product_id wajib");
  return successResponse(await getRecipe(productId));
}, "sales-funnel.recipes.GET");

/** Ganti seluruh resep sebuah produk — super_admin (konfigurasi ala stages). */
export const PUT = apiHandler(async (request: NextRequest) => {
  requireRole(await requireSalesFunnelUser(), ["super_admin"]);
  const body = await validateBody(request, putRecipeSchema);
  return successResponse(await replaceRecipe(body), "Resep disimpan");
}, "sales-funnel.recipes.PUT");
