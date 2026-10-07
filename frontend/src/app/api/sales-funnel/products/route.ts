import { successResponse } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { listCatalogProducts } from "@/lib/sales-funnel/catalog-server";
import { requireSalesFunnelUser } from "@/lib/sales-funnel/server";

/** Katalog produk untuk picker quotation (Fase F1) — pos_products aktif, bidang minimal. */
export const GET = apiHandler(async () => {
  await requireSalesFunnelUser();
  return successResponse(await listCatalogProducts());
}, "sales-funnel.products.GET");
