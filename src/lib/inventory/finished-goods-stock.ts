import { query as dbQuery } from "@/lib/db";
import { branchScopeOr, companyScopeOr, type UserScope } from "@/lib/api/scope";
import { createServerPgClient } from "@/lib/pg/create-client";

export interface ProductStockVariant {
  sku_id: string;
  sku: string;
  name: string;
  options: Record<string, string> | null;
  stock_quantity: number;
}

type FinishedGoodsRow = { product_id?: string | null; [key: string]: unknown };

type VariantRow = {
  product_id: string;
  sku_id: string;
  sku: string;
  name: string;
  options: unknown;
  stock_quantity: number | string | null;
};

/**
 * EPIC-047 Fase 1C — satu query tambahan ber-parameter untuk mengambil SKU
 * aktif per produk merchandise di halaman ini saja (bukan mengubah view
 * `v_finished_goods_stock`). Produk tanpa SKU (F&B) tidak kena query ini
 * sama sekali karena JOIN ke pos_product_skus.
 */
async function loadVariantsByProductId(productIds: string[]): Promise<Map<string, ProductStockVariant[]>> {
  const byProduct = new Map<string, ProductStockVariant[]>();
  if (productIds.length === 0) return byProduct;

  const rows = await dbQuery<VariantRow>(
    `SELECT sp.source_product_id AS product_id,
            sk.id AS sku_id,
            sk.sku,
            sk.name,
            sk.options,
            sk.stock_quantity
       FROM pos.pos_products sp
       JOIN pos.pos_product_skus sk ON sk.product_id = sp.id AND sk.is_active = true
      WHERE sp.product_kind = 'merchandise'
        AND sp.source_product_id = ANY($1::uuid[])
      ORDER BY sk.sku ASC`,
    [productIds]
  );

  for (const row of rows) {
    const list = byProduct.get(row.product_id) ?? [];
    list.push({
      sku_id: row.sku_id,
      sku: row.sku,
      name: row.name,
      options: (row.options ?? null) as Record<string, string> | null,
      stock_quantity: Number(row.stock_quantity) || 0,
    });
    byProduct.set(row.product_id, list);
  }
  return byProduct;
}

/** Stok barang jadi per produk (view v_finished_goods_stock) + varian SKU merchandise. */
export async function listFinishedGoodsStock(opts: {
  scope: UserScope | null;
  search: string;
  status: string;
  warehouseId: string;
  page: number;
  limit: number;
}) {
  const { scope, search, status, warehouseId, page, limit } = opts;
  const offset = (page - 1) * limit;
  const db = await createServerPgClient();
  let q = db
    .from("v_finished_goods_stock")
    .select("*", { count: "exact" })
    .order("product_nama", { ascending: true })
    .range(offset, offset + limit - 1);

  const companyOr = companyScopeOr(scope);
  if (companyOr) q = q.or(companyOr);
  const branchOr = branchScopeOr(scope);
  if (branchOr) q = q.or(branchOr);
  if (search) q = q.or(`product_nama.ilike.%${search}%,product_kode.ilike.%${search}%`);
  if (status === "out_of_stock") q = q.lte("qty_available", 0);
  if (status === "in_stock") q = q.gt("qty_available", 0);
  if (warehouseId && warehouseId !== "all") q = q.eq("warehouse_id", warehouseId);

  const { data, error, count } = await q;
  if (error) throw error;

  const rows = (data || []) as FinishedGoodsRow[];
  const productIds = [
    ...new Set(rows.map((row) => row.product_id).filter((id): id is string => typeof id === "string" && id.length > 0)),
  ];
  const variantsByProduct = await loadVariantsByProductId(productIds);
  return {
    rows: rows.map((row) => {
      const variants = row.product_id ? (variantsByProduct.get(row.product_id) ?? []) : [];
      return { ...row, variants, variant_count: variants.length };
    }),
    total: count || 0,
  };
}
