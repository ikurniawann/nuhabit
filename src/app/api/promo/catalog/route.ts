import { NextResponse } from "next/server";
import { successResponse } from "@/lib/api/auth";
import { query } from "@/lib/db";
import { requirePromoContext } from "@/lib/promo/server";

// Produk & kategori POS untuk pemilih target promo/penawaran.
export async function GET() {
  const { error } = await requirePromoContext();
  if (error) return error;

  try {
    const [products, categories] = await Promise.all([
      query<{ id: string; name: string; price: string; category_id: string | null }>(
        `SELECT id, name, base_price::text AS price, category_id
           FROM pos.pos_products
          WHERE is_active IS NOT FALSE
          ORDER BY name`
      ),
      query<{ id: string; name: string }>(
        `SELECT id, name FROM pos.pos_categories
          WHERE is_active IS NOT FALSE
          ORDER BY display_order NULLS LAST, name`
      ),
    ]);
    return successResponse({ products, categories });
  } catch (err) {
    console.error("[promo/catalog] GET failed:", err);
    return NextResponse.json(
      { success: false, error: "Gagal memuat katalog" },
      { status: 500 }
    );
  }
}
