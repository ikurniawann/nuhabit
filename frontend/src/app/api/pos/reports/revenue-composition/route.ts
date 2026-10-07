import { NextRequest, NextResponse } from "next/server";
import { createPgClient } from "@/lib/pg/create-client";
import { getPosSession } from "@/lib/api/auth";
import { query } from "@/lib/db";
import { itemCategoryLabelMap, lookupItemCategoryName } from "@/lib/pos/profit-category";
import {
  REVENUE_GROUP_LABEL,
  emptyBucket,
  finalizeBucket,
  resolveRevenueGroup,
  safePct,
  type RevenueBucket,
  type RevenueGroupId,
} from "@/lib/pos/revenue-composition";

type PosOrderRow = {
  id: string;
  ordered_at?: string | null;
};

type PosOrderItemRow = {
  order_id: string;
  product_id?: string | null;
  product_name?: string | null;
  product_sku?: string | null;
  quantity?: number | string | null;
  total_amount?: number | string | null;
  cost_total?: number | string | null;
  cost_price?: number | string | null;
  station?: string | null;
};

type PosProductRow = { id: string; category_id?: string | null };
type PosCategoryRow = { id: string; name?: string | null };
type ItemCategoryRow = { code?: string | null; nama?: string | null };

function toNumber(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function accumulate(
  map: Map<string, RevenueBucket>,
  id: string,
  label: string,
  quantity: number,
  sales: number,
  cost: number
) {
  const bucket = map.get(id) || emptyBucket(id, label);
  bucket.quantity += quantity;
  bucket.sales += sales;
  bucket.cost += cost;
  map.set(id, bucket);
}

// GET /api/pos/reports/revenue-composition
// Komposisi pendapatan Food vs Beverage, masing-masing dengan penjualan,
// HPP, margin, dan rinciannya per kategori.
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

    // Definisi pendapatan disamakan dengan laporan profit & transaksi: order
    // yang sudah dibayar dan tidak dibatalkan. Alur POS live menyisakan order
    // LUNAS berstatus 'pending', jadi status fulfilment tidak dipakai.
    const { data: orders, error: orderError } = await db
      .from("pos_orders")
      .select("id, ordered_at")
      .not("status", "in", '("cancelled","voided","merged")')
      .eq("payment_status", "paid")
      .gte("ordered_at", startDate.toISOString())
      .lte("ordered_at", endDate.toISOString());

    if (orderError) throw orderError;

    const orderRows = (orders || []) as PosOrderRow[];
    const orderIds = orderRows.map((order) => order.id);
    const orderedAtById = new Map(orderRows.map((order) => [order.id, order.ordered_at || null]));

    const emptyGroups = (["food", "beverage"] as RevenueGroupId[]).map((id) =>
      finalizeBucket(emptyBucket(id, REVENUE_GROUP_LABEL[id]), { sales: 0, quantity: 0 })
    );

    if (orderIds.length === 0) {
      return NextResponse.json({
        success: true,
        data: {
          filters: { date_from: from, date_to: to },
          summary: {
            orders: 0,
            items: 0,
            quantity: 0,
            sales: 0,
            cost: 0,
            margin: 0,
            cost_pct: 0,
            zero_cost_items: 0,
          },
          groups: emptyGroups.map((group) => ({ ...group, categories: [] })),
          daily: [],
        },
      });
    }

    const { data: items, error: itemError } = await db
      .from("pos_order_items")
      .select(
        "order_id, product_id, product_name, product_sku, quantity, total_amount, cost_price, cost_total, station"
      )
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
      new Set(productRows.map((p) => p.category_id).filter((id): id is string => Boolean(id)))
    );

    const { data: categories, error: categoryError } = categoryIds.length
      ? await db.from("pos_categories").select("id, name").in("id", categoryIds)
      : { data: [], error: null };
    if (categoryError) throw categoryError;

    const posCategoryById = new Map(
      ((categories || []) as PosCategoryRow[]).map((c) => [c.id, c.name || null])
    );

    // Kategori sebenarnya ada di master item; pos_categories hanya bucket kasir.
    // Produk lama yang belum punya source_product_id dicocokkan lewat SKU.
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
    const itemKategoriByPosId = new Map(itemKategoriRows.map((row) => [row.id, row.kategori]));

    const { data: itemCategories, error: itemCategoryError } = productIds.length
      ? await db.from("product_categories").select("code, nama").is("deleted_at", null)
      : { data: [], error: null };
    if (itemCategoryError) throw itemCategoryError;

    const itemCategoryLabels = itemCategoryLabelMap((itemCategories || []) as ItemCategoryRow[]);

    const groupTotals = new Map<string, RevenueBucket>();
    const categoryTotals = new Map<RevenueGroupId, Map<string, RevenueBucket>>();
    const dailyTotals = new Map<string, { food: RevenueBucket; beverage: RevenueBucket }>();

    let quantity = 0;
    let sales = 0;
    let cost = 0;
    let zeroCostItems = 0;

    for (const item of itemRows) {
      const itemQty = toNumber(item.quantity);
      const itemSales = toNumber(item.total_amount);
      const itemCost = toNumber(item.cost_total);

      const posCategoryName = item.product_id
        ? posCategoryById.get(productById.get(item.product_id)?.category_id || "") || null
        : null;
      const itemCategoryCode = item.product_id
        ? itemKategoriByPosId.get(item.product_id) || null
        : null;
      const itemCategoryName = lookupItemCategoryName(itemCategoryCode, itemCategoryLabels);

      const groupId = resolveRevenueGroup({
        itemCategory: itemCategoryCode,
        posCategoryName,
        station: item.station,
      });

      quantity += itemQty;
      sales += itemSales;
      cost += itemCost;
      if (itemSales > 0 && toNumber(item.cost_price) === 0) zeroCostItems += 1;

      accumulate(groupTotals, groupId, REVENUE_GROUP_LABEL[groupId], itemQty, itemSales, itemCost);

      if (!categoryTotals.has(groupId)) categoryTotals.set(groupId, new Map());
      const label = itemCategoryName || posCategoryName || "Tanpa kategori";
      accumulate(categoryTotals.get(groupId)!, label.toLowerCase(), label, itemQty, itemSales, itemCost);

      const orderedAt = orderedAtById.get(item.order_id);
      const dayKey = orderedAt ? String(orderedAt).slice(0, 10) : "—";
      if (!dailyTotals.has(dayKey)) {
        dailyTotals.set(dayKey, {
          food: emptyBucket("food", REVENUE_GROUP_LABEL.food),
          beverage: emptyBucket("beverage", REVENUE_GROUP_LABEL.beverage),
        });
      }
      const day = dailyTotals.get(dayKey)!;
      day[groupId].quantity += itemQty;
      day[groupId].sales += itemSales;
      day[groupId].cost += itemCost;
    }

    const totals = { sales, quantity };

    const groups = (["food", "beverage"] as RevenueGroupId[]).map((id) => {
      const bucket = groupTotals.get(id) || emptyBucket(id, REVENUE_GROUP_LABEL[id]);
      const rows = Array.from((categoryTotals.get(id) || new Map<string, RevenueBucket>()).values())
        .map((row) => finalizeBucket(row, { sales: bucket.sales, quantity: bucket.quantity }))
        .sort((a, b) => b.sales - a.sales);
      return { ...finalizeBucket(bucket, totals), categories: rows };
    });

    const daily = Array.from(dailyTotals.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, buckets]) => {
        const daySales = buckets.food.sales + buckets.beverage.sales;
        const dayQty = buckets.food.quantity + buckets.beverage.quantity;
        return {
          date,
          food: finalizeBucket(buckets.food, { sales: daySales, quantity: dayQty }),
          beverage: finalizeBucket(buckets.beverage, { sales: daySales, quantity: dayQty }),
        };
      });

    return NextResponse.json({
      success: true,
      data: {
        filters: { date_from: from, date_to: to },
        summary: {
          orders: orderRows.length,
          items: itemRows.length,
          quantity,
          sales: Math.round(sales * 100) / 100,
          cost: Math.round(cost * 100) / 100,
          margin: Math.round((sales - cost) * 100) / 100,
          cost_pct: safePct(cost, sales),
          zero_cost_items: zeroCostItems,
        },
        groups,
        daily,
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Gagal memuat laporan komposisi pendapatan";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
