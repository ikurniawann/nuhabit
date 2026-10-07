import { resolvePosStation } from "@/lib/pos/kitchen-station";

type PgServiceClient = import("@/lib/pg/types").DbClient;

type PurchasingProduct = {
  id: string;
  kode?: string | null;
  nama?: string | null;
  deskripsi?: string | null;
  kategori?: string | null;
  harga_jual?: number | string | null;
  hpp_estimasi?: number | string | null;
  estimated_cogs?: number | string | null;
  is_active?: boolean | null;
  station?: string | null;
};

type PosCategory = {
  id: string;
  name?: string | null;
};

export type PosProductCostRow = {
  id: string;
  sku?: string | null;
  name?: string | null;
  base_price?: number | string | null;
  cost_price?: number | string | null;
};

function toNumber(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function normalizeCategoryName(value?: string | null) {
  const category = String(value || "").trim();
  if (!category) return "Makanan";
  if (/minuman|drink|coffee|kopi|tea|bar/i.test(category)) return "Minuman";
  if (/dessert|roti|cake|bakery|pastry/i.test(category)) return "Dessert";
  if (/snack|cemilan/i.test(category)) return "Snack";
  return category;
}

function skuForPurchasingProduct(product: Pick<PurchasingProduct, "id" | "kode">) {
  return `PUR-${product.kode || product.id.slice(0, 8)}`;
}

async function findOrCreateCategory(
  db: PgServiceClient,
  name: string
) {
  const { data: existing, error: existingError } = await db
    .from("pos_categories")
    .select("id, name")
    .ilike("name", name)
    .limit(1)
    .maybeSingle();

  if (existingError && existingError.code !== "PGRST116") throw existingError;
  if (existing) return (existing as PosCategory).id;

  const { data: created, error: createError } = await db
    .from("pos_categories")
    .insert({ name, is_active: true })
    .select("id")
    .single();

  if (createError) {
    console.warn("POS category create warning:", createError.message);
    return null;
  }

  return (created as { id: string }).id;
}

export async function syncPurchasingProductToPos(
  db: PgServiceClient,
  purchasingProductId: string,
  options: { station?: string | null; costPriceOverride?: number | null } = {}
) {
  const { data: product, error: productError } = await db
    .from("v_products_cogs")
    .select("*")
    .eq("id", purchasingProductId)
    .single();

  if (productError || !product) {
    throw productError ?? new Error("Purchasing product not found");
  }

  const purchasingProduct = product as PurchasingProduct;
  const sku = skuForPurchasingProduct(purchasingProduct);
  const categoryName = normalizeCategoryName(purchasingProduct.kategori);
  const categoryId = await findOrCreateCategory(db, categoryName);
  const basePrice = toNumber(purchasingProduct.harga_jual);
  const costPrice = options.costPriceOverride != null
    ? toNumber(options.costPriceOverride)
    : toNumber(purchasingProduct.hpp_estimasi ?? purchasingProduct.estimated_cogs);
  const now = new Date().toISOString();

  const payload = {
    sku,
    name: purchasingProduct.nama || sku,
    description: purchasingProduct.deskripsi || `Synced from Purchasing product ${purchasingProduct.kode || purchasingProduct.id}`,
    category_id: categoryId,
    base_price: basePrice,
    cost_price: costPrice,
    is_active: purchasingProduct.is_active !== false,
    is_available: true,
    inventory_tracking: false,
    station: resolvePosStation(
      options.station ?? purchasingProduct.station,
      purchasingProduct.kategori
    ),
    updated_at: now,
  };

  const { data: existing, error: existingError } = await db
    .from("pos_products")
    .select("id")
    .eq("sku", sku)
    .maybeSingle();

  if (existingError && existingError.code !== "PGRST116") throw existingError;

  if (existing?.id) {
    const { data: updated, error: updateError } = await db
      .from("pos_products")
      .update(payload)
      .eq("id", existing.id)
      .select("*")
      .single();

    if (updateError) throw updateError;
    return buildSyncResult("updated", updated as PosProductCostRow, costPrice);
  }

  const { data: created, error: createError } = await db
    .from("pos_products")
    .insert({
      ...payload,
      created_at: now,
    })
    .select("*")
    .single();

  if (createError) throw createError;
  return buildSyncResult("created", created as PosProductCostRow, costPrice);
}

export async function syncProductionHppToPos(
  db: PgServiceClient,
  purchasingProductId: string,
  hppPerUnit: number
) {
  return syncPurchasingProductToPos(db, purchasingProductId, {
    costPriceOverride: hppPerUnit,
  });
}

function buildSyncResult(mode: "created" | "updated", product: PosProductCostRow, costPrice: number) {
  const basePrice = toNumber(product.base_price);
  const grossProfit = basePrice - costPrice;
  const marginPct = basePrice > 0 ? Math.round((grossProfit / basePrice) * 10000) / 100 : 0;

  return {
    mode,
    product,
    cost_price: costPrice,
    base_price: basePrice,
    gross_profit: grossProfit,
    margin_percentage: marginPct,
  };
}

export async function loadPosProductCostMap(
  db: PgServiceClient,
  productIds: string[]
) {
  const ids = Array.from(new Set(productIds.filter(Boolean)));
  if (ids.length === 0) return new Map<string, PosProductCostRow>();

  const { data, error } = await db
    .from("pos_products")
    .select("id, sku, name, base_price, cost_price")
    .in("id", ids);

  if (error) throw error;

  return new Map(
    ((data || []) as PosProductCostRow[]).map((product) => [product.id, product])
  );
}

export async function enrichPosProductsWithPurchasingCogs(
  db: PgServiceClient,
  products: Array<Record<string, unknown>>
) {
  const kodes = Array.from(
    new Set(
      products
        .map((product) => {
          const sku = String(product.sku || "");
          if (!sku.startsWith("PUR-")) return null;
          const kode = sku.slice(4).trim();
          return kode || null;
        })
        .filter((kode): kode is string => Boolean(kode))
    )
  );

  if (kodes.length === 0) return products;

  const { data: cogsRows, error } = await db
    .from("v_products_cogs")
    .select("kode, hpp_estimasi, estimated_cogs")
    .in("kode", kodes);

  if (error) {
    console.warn("POS products COGS enrichment warning:", error.message);
    return products;
  }

  const cogsByKode = new Map(
    ((cogsRows || []) as Array<{ kode?: string | null; hpp_estimasi?: number | string | null; estimated_cogs?: number | string | null }>).map(
      (row) => [String(row.kode || ""), row]
    )
  );

  return products.map((product) => {
    const sku = String(product.sku || "");
    if (!sku.startsWith("PUR-")) return product;

    const kode = sku.slice(4).trim();
    const cogs = cogsByKode.get(kode);
    if (!cogs) return product;

    const hpp = toNumber(cogs.hpp_estimasi ?? cogs.estimated_cogs);
    const storedCost = toNumber(product.cost_price);
    const costPrice = hpp > 0 ? hpp : storedCost;

    return {
      ...product,
      cost_price: costPrice,
      estimated_cogs: hpp,
      hpp_estimasi: hpp,
    };
  });
}

export function buildCostSnapshot(
  product: PosProductCostRow | undefined,
  quantity: number,
  totalAmount: number
) {
  const costPrice = toNumber(product?.cost_price);
  const costTotal = Math.round(costPrice * quantity * 100) / 100;
  const grossProfit = Math.round((totalAmount - costTotal) * 100) / 100;
  const grossMarginPct = totalAmount > 0 ? Math.round((grossProfit / totalAmount) * 10000) / 100 : 0;

  return {
    cost_price: costPrice,
    cost_total: costTotal,
    gross_profit: grossProfit,
    gross_margin_pct: grossMarginPct,
  };
}
