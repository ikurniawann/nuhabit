import { z } from "zod";
import { formatNumber } from "@/lib/format";
import type { DbClient } from "@/lib/pg/types";
import { dayEndIso, dayStartIso } from "@/lib/purchasing/report-query";
import { toQty } from "@/lib/purchasing/utils";

type Numeric = number | string | null | undefined;

export const productionInHouseQuerySchema = z.object({
  date_from: z.string().optional(),
  date_to: z.string().optional(),
  date_field: z.enum(["completed_at", "created_at"]).default("completed_at"),
  status: z.string().optional(),
  output_type: z.enum(["all", "FINISHED_GOOD", "WIP"]).default("all"),
  product_id: z.string().uuid().optional(),
  warehouse_id: z.string().uuid().optional(),
  export: z.enum(["json", "csv"]).default("json"),
});

export type ProductionInHouseQuery = z.infer<typeof productionInHouseQuerySchema>;

export interface ProductionOrderViewRow {
  id: string;
  nomor_produksi?: string | null;
  product_id?: string | null;
  product_kode?: string | null;
  product_nama?: string | null;
  item_kode?: string | null;
  item_nama?: string | null;
  output_type?: string | null;
  status?: string | null;
  planned_qty?: Numeric;
  actual_qty?: Numeric;
  hpp_per_unit?: Numeric;
  actual_material_cost?: Numeric;
  planned_material_cost?: Numeric;
  overhead_cost?: Numeric;
  labor_cost?: Numeric;
  packaging_cost?: Numeric;
  waste_cost?: Numeric;
  created_at?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
}

export interface ProductWarehouse {
  warehouse_id: string | null;
  warehouse_name: string | null;
  warehouse_code: string | null;
}

const NO_WAREHOUSE: ProductWarehouse = { warehouse_id: null, warehouse_name: null, warehouse_code: null };
const round2 = (value: number) => Math.round(value * 100) / 100;
const round3 = (value: number) => Math.round(value * 1000) / 1000;

export const EMPTY_PRODUCTION_REPORT = {
  orders: [],
  by_status: [],
  summary: {
    total_orders: 0,
    total_planned_qty: 0,
    total_actual_qty: 0,
    total_hpp_value: 0,
    completed_orders: 0,
  },
};

/** Nilai HPP: qty aktual x HPP/unit kalau ada, selain itu jumlah komponen biaya. */
function mapProductionOrder(row: ProductionOrderViewRow, warehouse: ProductWarehouse = NO_WAREHOUSE) {
  const plannedQty = toQty(row.planned_qty);
  const actualQty = toQty(row.actual_qty);
  const hppPerUnit = toQty(row.hpp_per_unit);
  const materialCost = toQty(row.actual_material_cost ?? row.planned_material_cost);
  const overhead = toQty(row.overhead_cost);
  const labor = toQty(row.labor_cost);
  const packaging = toQty(row.packaging_cost);
  const waste = toQty(row.waste_cost);
  const hppValue =
    actualQty > 0 && hppPerUnit > 0
      ? actualQty * hppPerUnit
      : materialCost + overhead + labor + packaging + waste;

  return {
    id: row.id,
    nomor_produksi: row.nomor_produksi,
    product_id: row.product_id,
    product_kode: row.product_kode || row.item_kode || "",
    product_nama: row.product_nama || row.item_nama || "-",
    output_type: row.output_type || "FINISHED_GOOD",
    status: String(row.status || "UNKNOWN").toUpperCase(),
    planned_qty: plannedQty,
    actual_qty: actualQty,
    hpp_per_unit: hppPerUnit,
    hpp_per_unit_formatted: formatNumber(hppPerUnit),
    actual_material_cost: materialCost,
    overhead_cost: overhead,
    labor_cost: labor,
    packaging_cost: packaging,
    waste_cost: waste,
    total_hpp_value: round2(hppValue),
    total_hpp_value_formatted: formatNumber(hppValue),
    hppValue,
    ...warehouse,
    created_at: row.created_at,
    started_at: row.started_at,
    completed_at: row.completed_at,
  };
}

export function buildProductionInHouseReport(
  rows: ProductionOrderViewRow[],
  warehouseByProduct: Map<string, ProductWarehouse>
) {
  const byStatus: Record<string, { count: number; actual_qty: number; hpp_value: number }> = {};
  const totals = { planned: 0, actual: 0, hppValue: 0, completed: 0 };

  const orders = rows.map((row) => {
    const { hppValue, ...order } = mapProductionOrder(
      row,
      (row.product_id && warehouseByProduct.get(row.product_id)) || NO_WAREHOUSE
    );
    totals.planned += order.planned_qty;
    totals.actual += order.actual_qty;
    totals.hppValue += hppValue;
    if (order.status === "COMPLETED") totals.completed += 1;

    const bucket = (byStatus[order.status] ??= { count: 0, actual_qty: 0, hpp_value: 0 });
    bucket.count += 1;
    bucket.actual_qty += order.actual_qty;
    bucket.hpp_value += hppValue;
    return order;
  });

  return {
    orders,
    by_status: Object.entries(byStatus)
      .map(([status, value]) => ({
        status,
        count: value.count,
        actual_qty: round3(value.actual_qty),
        hpp_value: round2(value.hpp_value),
        hpp_value_formatted: formatNumber(value.hpp_value),
      }))
      .sort((a, b) => b.count - a.count),
    summary: {
      total_orders: orders.length,
      total_planned_qty: round3(totals.planned),
      total_actual_qty: round3(totals.actual),
      total_hpp_value: round2(totals.hppValue),
      completed_orders: totals.completed,
    },
  };
}

type ProductionOrderReportRow = ReturnType<typeof buildProductionInHouseReport>["orders"][number];

export function productionInHouseCsvRows(orders: ProductionOrderReportRow[]) {
  return {
    header: [
      "No Produksi",
      "Produk Kode",
      "Produk Nama",
      "Output Type",
      "Status",
      "Qty Planned",
      "Qty Actual",
      "HPP / Unit",
      "Total HPP",
      "Stall",
      "Created At",
      "Completed At",
    ],
    rows: orders.map((order) => [
      order.nomor_produksi || "",
      order.product_kode,
      order.product_nama,
      order.output_type,
      order.status,
      String(order.planned_qty),
      String(order.actual_qty),
      String(order.hpp_per_unit),
      String(order.total_hpp_value),
      order.warehouse_name || order.warehouse_code || "",
      order.created_at || "",
      order.completed_at || "",
    ]),
  };
}

/** null = tidak difilter gudang; [] = gudang tanpa produk aktif. */
export async function loadWarehouseProductIds(db: DbClient, warehouseId?: string) {
  if (!warehouseId) return null;
  const { data, error } = await db
    .from("products")
    .select("id")
    .eq("warehouse_id", warehouseId)
    .eq("is_active", true);
  if (error) throw error;
  return ((data || []) as Array<{ id: string }>).map((product) => product.id);
}

export async function loadProductionOrders(
  db: DbClient,
  params: ProductionInHouseQuery,
  productIds: string[] | null
) {
  const dateField = params.date_field;
  let query = db
    .from("v_production_orders")
    .select("*")
    .eq("production_context", "product")
    .order(dateField, { ascending: false, nullsFirst: false });

  if (params.date_from) query = query.gte(dateField, dayStartIso(params.date_from));
  if (params.date_to) query = query.lte(dateField, dayEndIso(params.date_to));
  if (params.status && params.status !== "all") query = query.eq("status", params.status.toUpperCase());
  if (params.output_type !== "all") query = query.eq("output_type", params.output_type);
  if (params.product_id) query = query.eq("product_id", params.product_id);
  if (productIds) query = query.in("product_id", productIds);

  const { data, error } = await query;
  if (error) throw error;
  return (data || []) as ProductionOrderViewRow[];
}

/** Gudang (stall) asal tiap produk, untuk kolom Stall di laporan. */
export async function loadProductWarehouses(db: DbClient, productIds: string[]) {
  const result = new Map<string, ProductWarehouse>();
  if (productIds.length === 0) return result;

  const { data: products, error } = await db.from("products").select("id, warehouse_id").in("id", productIds);
  if (error) throw error;
  const productRows = (products || []) as Array<{ id: string; warehouse_id?: string | null }>;

  const warehouseIds = Array.from(
    new Set(productRows.map((p) => p.warehouse_id).filter((id): id is string => Boolean(id)))
  );
  const warehouseMap = new Map<string, { name: string; code: string }>();
  if (warehouseIds.length > 0) {
    const { data: warehouses, error: warehouseError } = await db
      .from("warehouses")
      .select("id, name, code")
      .in("id", warehouseIds);
    if (warehouseError) throw warehouseError;
    for (const wh of (warehouses || []) as Array<{ id: string; name: string; code: string }>) {
      warehouseMap.set(wh.id, { name: wh.name, code: wh.code });
    }
  }

  for (const product of productRows) {
    const wh = product.warehouse_id ? warehouseMap.get(product.warehouse_id) : null;
    result.set(product.id, {
      warehouse_id: product.warehouse_id ?? null,
      warehouse_name: wh?.name ?? null,
      warehouse_code: wh?.code ?? null,
    });
  }
  return result;
}
