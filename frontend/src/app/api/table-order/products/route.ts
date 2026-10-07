import { NextRequest, NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { buildCategories } from "@/lib/table-order/menu";
import { loadCatalogMeta, loadSellableCatalog } from "@/lib/table-order/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/table-order/products?search= — katalog publik self-order meja.
 * Sumber = pos.pos_products aktif & tersedia (katalog yang sama dengan kasir/KDS),
 * plus daftar kategori (hanya yang punya produk) dan meta diagnosa agar layar
 * bisa menjelaskan kenapa menu kosong (belum ada produk POS vs semua
 * ditandai tidak tersedia).
 */
export const GET = apiHandler(async (request: NextRequest) => {
  const search = request.nextUrl.searchParams.get("search");
  const [products, meta] = await Promise.all([
    loadSellableCatalog(search),
    loadCatalogMeta(),
  ]);
  return NextResponse.json({
    success: true,
    data: products,
    categories: buildCategories(products),
    meta,
  });
}, "table-order/products");
