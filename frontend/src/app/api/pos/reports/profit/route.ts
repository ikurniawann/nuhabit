import { NextRequest, NextResponse } from "next/server";
import { createPgClient } from "@/lib/pg/create-client";
import { getPosSession } from "@/lib/api/auth";
import { query } from "@/lib/db";
import {
  itemCategoryLabelMap,
  lookupItemCategoryName,
  resolveProfitCategory,
} from "@/lib/pos/profit-category";

type PosOrderRow = {
  id: string;
  order_number?: string | null;
  ordered_at?: string | null;
  cashier_id?: string | null;
  total_amount?: number | string | null;
};

type PosOrderItemRow = {
  order_id: string;
  product_id?: string | null;
  product_name?: string | null;
  product_sku?: string | null;
  quantity?: number | string | null;
  total_amount?: number | string | null;
  cost_price?: number | string | null;
  cost_total?: number | string | null;
  gross_profit?: number | string | null;
  gross_margin_pct?: number | string | null;
  station?: string | null;
};

type PosProductRow = {
  id: string;
  category_id?: string | null;
};

type PosCategoryRow = {
  id: string;
  name?: string | null;
};

type ItemCategoryRow = {
  code?: string | null;
  nama?: string | null;
};

type ProfitBucket = {
  id: string;
  label: string;
  quantity: number;
  revenue: number;
  cogs: number;
  gross_profit: number;
  gross_margin_pct: number;
};

function toNumber(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function roundCurrency(value: number) {
  return Math.round(value * 100) / 100;
}

function marginPct(revenue: number, profit: number) {
  return revenue > 0 ? Math.round((profit / revenue) * 10000) / 100 : 0;
}

function dateKey(value?: string | null) {
  if (!value) return "Tanpa tanggal";
  return new Date(value).toISOString().slice(0, 10);
}

function addToBucket(
  map: Map<string, ProfitBucket>,
  id: string,
  label: string,
  quantity: number,
  revenue: number,
  cogs: number,
  profit: number
) {
  const existing = map.get(id) || {
    id,
    label,
    quantity: 0,
    revenue: 0,
    cogs: 0,
    gross_profit: 0,
    gross_margin_pct: 0,
  };

  existing.quantity += quantity;
  existing.revenue += revenue;
  existing.cogs += cogs;
  existing.gross_profit += profit;
  existing.gross_margin_pct = marginPct(existing.revenue, existing.gross_profit);
  map.set(id, existing);
}

function sortBuckets(map: Map<string, ProfitBucket>) {
  return Array.from(map.values())
    .map((item) => ({
      ...item,
      revenue: roundCurrency(item.revenue),
      cogs: roundCurrency(item.cogs),
      gross_profit: roundCurrency(item.gross_profit),
      gross_margin_pct: marginPct(item.revenue, item.gross_profit),
    }))
    .sort((a, b) => b.gross_profit - a.gross_profit);
}

export async function GET(request: NextRequest) {
  const sessionUserId = await getPosSession();
  if (!sessionUserId) {
    return NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 });
  }

  try {
    const db = createPgClient();
    const searchParams = request.nextUrl.searchParams;
    const now = new Date();
    const defaultStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const from = searchParams.get("date_from") || defaultStart.toISOString().slice(0, 10);
    const to = searchParams.get("date_to") || now.toISOString().slice(0, 10);
    const startDate = new Date(`${from}T00:00:00.000Z`);
    const endDate = new Date(`${to}T23:59:59.999Z`);

    const { data: orders, error: orderError } = await db
      .from("pos_orders")
      .select("id, order_number, ordered_at, cashier_id, total_amount")
      // Alur POS live menyisakan order LUNAS berstatus 'pending' (status
      // fulfilment tidak pernah maju ke 'completed'). Pendapatan = yang sudah
      // dibayar dan tidak batal — definisi yang sama dengan laporan transaksi.
      .not("status", "in", '("cancelled","voided","merged")')
      .eq("payment_status", "paid")
      .gte("ordered_at", startDate.toISOString())
      .lte("ordered_at", endDate.toISOString())
      .order("ordered_at", { ascending: false });

    if (orderError) throw orderError;

    const orderRows = (orders || []) as PosOrderRow[];
    const orderIds = orderRows.map((order) => order.id);
    const orderById = new Map(orderRows.map((order) => [order.id, order]));

    if (orderIds.length === 0) {
      return NextResponse.json({
        success: true,
        data: {
          filters: { date_from: from, date_to: to },
          summary: {
            orders: 0,
            items: 0,
            quantity: 0,
            revenue: 0,
            cogs: 0,
            gross_profit: 0,
            gross_margin_pct: 0,
            zero_cost_items: 0,
          },
          breakdowns: { products: [], categories: [], stations: [], cashiers: [], dates: [] },
        },
      });
    }

    const { data: items, error: itemError } = await db
      .from("pos_order_items")
      .select("order_id, product_id, product_name, product_sku, quantity, total_amount, cost_price, cost_total, gross_profit, gross_margin_pct, station")
      .in("order_id", orderIds);

    if (itemError) throw itemError;

    const itemRows = (items || []) as PosOrderItemRow[];
    const productIds = Array.from(
      new Set(itemRows.map((item) => item.product_id).filter((id): id is string => Boolean(id)))
    );

    const { data: products, error: productError } = productIds.length
      ? await db.from("pos_products").select("id, category_id").in("id", productIds)
      : { data: [], error: null };
    if (productError) throw productError;

    const productRows = (products || []) as PosProductRow[];
    const productById = new Map(productRows.map((product) => [product.id, product]));
    const categoryIds = Array.from(
      new Set(productRows.map((product) => product.category_id).filter((id): id is string => Boolean(id)))
    );

    const { data: categories, error: categoryError } = categoryIds.length
      ? await db.from("pos_categories").select("id, name").in("id", categoryIds)
      : { data: [], error: null };
    if (categoryError) throw categoryError;

    const categoryById = new Map(
      ((categories || []) as PosCategoryRow[]).map((category) => [category.id, category.name || "Tanpa kategori"])
    );

    const itemKategoriRows = productIds.length
      ? await query<{ id: string; kategori: string | null }>(
          `SELECT pp.id,
                  COALESCE(p.kategori, p_sku.kategori) AS kategori
           FROM pos.pos_products pp
           LEFT JOIN item.products p
             ON p.id = pp.source_product_id AND p.deleted_at IS NULL
           LEFT JOIN item.products p_sku
             ON pp.source_product_id IS NULL
            AND pp.sku = ('PUR-' || p_sku.kode)
            AND p_sku.deleted_at IS NULL
            AND p_sku.kode IS NOT NULL
            AND btrim(p_sku.kode) <> ''
           WHERE pp.id = ANY($1::uuid[])`,
          [productIds]
        )
      : [];
    const itemKategoriByPosId = new Map(
      itemKategoriRows.map((row) => [row.id, row.kategori])
    );

    const { data: itemCategories, error: itemCategoryError } = productIds.length
      ? await db.from("product_categories").select("code, nama").is("deleted_at", null)
      : { data: [], error: null };
    if (itemCategoryError) throw itemCategoryError;

    const itemCategoryLabels = itemCategoryLabelMap((itemCategories || []) as ItemCategoryRow[]);

    const productBuckets = new Map<string, ProfitBucket>();
    const categoryBuckets = new Map<string, ProfitBucket>();
    const stationBuckets = new Map<string, ProfitBucket>();
    const cashierBuckets = new Map<string, ProfitBucket>();
    const dateBuckets = new Map<string, ProfitBucket>();
    let quantity = 0;
    let revenue = 0;
    let cogs = 0;
    let grossProfit = 0;
    let zeroCostItems = 0;

    for (const item of itemRows) {
      const order = orderById.get(item.order_id);
      const itemQuantity = toNumber(item.quantity);
      const itemRevenue = toNumber(item.total_amount);
      const itemCogs = toNumber(item.cost_total);
      const itemProfit = item.gross_profit == null ? itemRevenue - itemCogs : toNumber(item.gross_profit);
      const productId = item.product_id || "unknown-product";
      const productLabel = item.product_name || item.product_sku || "Produk tanpa nama";
      const product = item.product_id ? productById.get(item.product_id) : null;
      const itemCategoryCode = item.product_id
        ? itemKategoriByPosId.get(item.product_id) || null
        : null;
      const category = resolveProfitCategory({
        itemCategoryCode,
        itemCategoryName: lookupItemCategoryName(itemCategoryCode, itemCategoryLabels),
        posCategoryName: product?.category_id
          ? categoryById.get(product.category_id) || null
          : null,
      });
      const categoryId = category.id;
      const categoryLabel = category.label;
      const station = item.station || "kitchen";
      const cashierId = order?.cashier_id || "unknown-cashier";
      const date = dateKey(order?.ordered_at);

      quantity += itemQuantity;
      revenue += itemRevenue;
      cogs += itemCogs;
      grossProfit += itemProfit;
      if (itemRevenue > 0 && toNumber(item.cost_price) === 0) zeroCostItems += 1;

      addToBucket(productBuckets, productId, productLabel, itemQuantity, itemRevenue, itemCogs, itemProfit);
      addToBucket(categoryBuckets, categoryId, categoryLabel, itemQuantity, itemRevenue, itemCogs, itemProfit);
      addToBucket(stationBuckets, station, station, itemQuantity, itemRevenue, itemCogs, itemProfit);
      addToBucket(cashierBuckets, cashierId, cashierId === "unknown-cashier" ? "Tanpa kasir" : cashierId.slice(0, 8), itemQuantity, itemRevenue, itemCogs, itemProfit);
      addToBucket(dateBuckets, date, date, itemQuantity, itemRevenue, itemCogs, itemProfit);
    }

    return NextResponse.json({
      success: true,
      data: {
        filters: { date_from: from, date_to: to },
        summary: {
          orders: orderRows.length,
          items: itemRows.length,
          quantity: roundCurrency(quantity),
          revenue: roundCurrency(revenue),
          cogs: roundCurrency(cogs),
          gross_profit: roundCurrency(grossProfit),
          gross_margin_pct: marginPct(revenue, grossProfit),
          zero_cost_items: zeroCostItems,
        },
        breakdowns: {
          products: sortBuckets(productBuckets),
          categories: sortBuckets(categoryBuckets),
          stations: sortBuckets(stationBuckets),
          cashiers: sortBuckets(cashierBuckets),
          dates: sortBuckets(dateBuckets).sort((a, b) => a.id.localeCompare(b.id)),
        },
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gagal memuat laporan profit POS";
    console.error("Error fetching POS profit report:", error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
