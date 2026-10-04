import { successResponse } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { loadPromoCatalog } from "@/lib/promo/campaigns-server";
import { requirePromoContext } from "@/lib/promo/server";

// Produk & kategori POS untuk pemilih target promo/penawaran.
export const GET = apiHandler(async () => {
  await requirePromoContext();
  return successResponse(await loadPromoCatalog());
}, "promo.catalog.GET");
