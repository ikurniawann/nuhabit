import { branchScopeOr, companyScopeOr, getApiUserScope } from "@/lib/api/scope";
import { rawMaterialStockSource } from "@/lib/api/stall-scope";
import type { DbClient } from "@/lib/pg/types";
import { toQty } from "@/lib/purchasing/utils";

type Numeric = number | string | null | undefined;

interface WipStockRow {
  id: string;
  kode?: string | null;
  nama?: string | null;
  kategori?: string | null;
  satuan_besar_nama?: string | null;
  qty_onhand?: Numeric;
  qty_on_order?: Numeric;
  avg_cost?: Numeric;
  status_stok?: string | null;
  source_product_id?: string | null;
}

interface SourceProductRow {
  id: string;
  kode?: string | null;
  nama?: string | null;
  kategori?: string | null;
  harga_jual?: Numeric;
}

interface WipBatchRow {
  id: string;
  wip_raw_material_id?: string | null;
  batch_number?: string | null;
  qty_produced?: Numeric;
  hpp_per_unit?: Numeric;
  total_cost?: Numeric;
  created_at?: string | null;
  production_order_id?: string | null;
  production_order?: { nomor_produksi?: string | null; status?: string | null } | null;
}

export interface WipSummary {
  total_wip: number;
  ready_wip: number;
  total_qty: number;
  total_value: number;
}

export function summarizeWip(items: Array<{ qty_onhand: number; avg_cost: number }>): WipSummary {
  return items.reduce(
    (acc, item) => {
      acc.total_wip += 1;
      acc.total_qty += item.qty_onhand;
      acc.total_value += item.qty_onhand * item.avg_cost;
      if (item.qty_onhand > 0) acc.ready_wip += 1;
      return acc;
    },
    { total_wip: 0, ready_wip: 0, total_qty: 0, total_value: 0 }
  );
}

/** Batch terbaru per bahan WIP (input sudah urut created_at desc). */
export function latestBatchByMaterial(batches: WipBatchRow[]) {
  const latest = new Map<string, WipBatchRow>();
  for (const batch of batches) {
    if (batch.wip_raw_material_id && !latest.has(batch.wip_raw_material_id)) {
      latest.set(batch.wip_raw_material_id, batch);
    }
  }
  return latest;
}

async function loadWipStock(db: DbClient) {
  const scope = await getApiUserScope();
  const { view, warehouseId } = await rawMaterialStockSource();
  let query = db.from(view).select("*").eq("material_type", "WIP").is("deleted_at", null);
  if (warehouseId) query = query.eq("warehouse_id", warehouseId);
  const companyOr = companyScopeOr(scope);
  if (companyOr) query = query.or(companyOr);
  const branchOr = branchScopeOr(scope);
  if (branchOr) query = query.or(branchOr);

  const { data, error } = await query.order("nama", { ascending: true });
  if (error) throw error;
  return (data || []) as WipStockRow[];
}

async function loadSourceProducts(db: DbClient, ids: string[]) {
  if (ids.length === 0) return [];
  const { data, error } = await db.from("products").select("id,kode,nama,kategori,harga_jual").in("id", ids);
  if (error) throw error;
  return (data || []) as SourceProductRow[];
}

async function loadWipBatches(db: DbClient, materialIds: string[]) {
  if (materialIds.length === 0) return [];
  const { data, error } = await db
    .from("production_batches")
    .select(`
      id,
      product_id,
      wip_raw_material_id,
      batch_number,
      qty_produced,
      hpp_per_unit,
      total_cost,
      created_at,
      production_order_id,
      production_order:production_orders!production_order_id(id,nomor_produksi,status)
    `)
    .eq("output_type", "WIP")
    .in("wip_raw_material_id", materialIds)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []) as WipBatchRow[];
}

export async function listWipInventory(db: DbClient) {
  const rows = await loadWipStock(db);
  const sourceProductIds = Array.from(
    new Set(rows.map((row) => row.source_product_id).filter((id): id is string => Boolean(id)))
  );
  const [sourceProducts, batches] = await Promise.all([
    loadSourceProducts(db, sourceProductIds),
    loadWipBatches(db, rows.map((row) => row.id)),
  ]);

  const sourceProductMap = new Map(sourceProducts.map((product) => [product.id, product]));
  const batchMap = latestBatchByMaterial(batches);

  const data = rows.map((row) => {
    const latestBatch = batchMap.get(row.id) || null;
    return {
      id: row.id,
      kode: row.kode || "",
      nama: row.nama || row.id,
      kategori: row.kategori || "-",
      satuan: row.satuan_besar_nama || "",
      qty_onhand: toQty(row.qty_onhand),
      qty_on_order: toQty(row.qty_on_order),
      avg_cost: toQty(row.avg_cost),
      status_stok: row.status_stok || "HABIS",
      source_product_id: row.source_product_id,
      source_product: row.source_product_id ? sourceProductMap.get(row.source_product_id) || null : null,
      latest_batch: latestBatch
        ? {
            id: latestBatch.id,
            batch_number: latestBatch.batch_number,
            qty_produced: toQty(latestBatch.qty_produced),
            hpp_per_unit: toQty(latestBatch.hpp_per_unit),
            total_cost: toQty(latestBatch.total_cost),
            created_at: latestBatch.created_at,
            production_order_id: latestBatch.production_order_id,
            production_order_number: latestBatch.production_order?.nomor_produksi || null,
            production_order_status: latestBatch.production_order?.status || null,
          }
        : null,
    };
  });

  return { data, summary: summarizeWip(data) };
}
