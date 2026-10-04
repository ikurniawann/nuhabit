import { z } from "zod";
import type { DbClient } from "@/lib/pg/types";
import { dayEndIso, dayStartIso } from "@/lib/purchasing/report-query";
import { toQty } from "@/lib/purchasing/utils";

type Numeric = number | string | null | undefined;
type MovementType = "in" | "out" | "adjustment" | "transfer" | "return";

export const stockCardQuerySchema = z.object({
  item_type: z.enum(["raw_material", "product"]).default("raw_material"),
  material_id: z.string().uuid().optional(),
  product_id: z.string().uuid().optional(),
  item_id: z.string().uuid().optional(),
  warehouse_id: z.string().uuid().optional(),
  search: z.string().optional(),
  tipe: z.enum(["all", "in", "out", "adjustment", "transfer", "return"]).default("all"),
  date_from: z.string().optional(),
  date_to: z.string().optional(),
  limit: z.coerce.number().min(1).max(500).default(200),
});

export type StockCardQuery = z.infer<typeof stockCardQuerySchema>;

interface StockItemRow {
  id: string;
  kode?: string | null;
  nama?: string | null;
  kategori?: string | null;
  satuan?: string | null;
  lokasi_rak?: string | null;
  qty_onhand?: Numeric;
  avg_cost?: Numeric;
  min_stock?: Numeric;
  max_stock?: Numeric;
  status_stok?: string | null;
  warehouse_id?: string | null;
  warehouse_name?: string | null;
}

/** Baris movement mentah (inventory_movements / finished_goods_movements). */
interface MovementDbRow {
  id: string;
  raw_material_id?: string | null;
  product_id?: string | null;
  warehouse_id?: string | null;
  tipe: MovementType;
  jumlah?: Numeric;
  qty_before?: Numeric;
  qty_after?: Numeric;
  unit_cost?: Numeric;
  total_cost?: Numeric;
  reference_type?: string | null;
  reference_id?: string | null;
  reference_number?: string | null;
  alasan?: string | null;
  catatan?: string | null;
  created_at?: string | null;
}

export type StockCardItem = ReturnType<typeof normalizeItem>;
export type StockCardMovement = ReturnType<typeof normalizeMovement>;

export function normalizeItem(row: StockItemRow) {
  return {
    id: row.id,
    kode: row.kode || "",
    nama: row.nama || row.id,
    kategori: row.kategori || "-",
    satuan: row.satuan || "",
    lokasi_rak: row.lokasi_rak || row.warehouse_name || "-",
    qty_onhand: toQty(row.qty_onhand),
    avg_cost: toQty(row.avg_cost),
    min_stock: toQty(row.min_stock),
    max_stock: row.max_stock == null ? null : toQty(row.max_stock),
    status_stok: row.status_stok || "AMAN",
    warehouse_id: row.warehouse_id || null,
    warehouse_name: row.warehouse_name || null,
  };
}

/** Biaya movement: unit_cost tercatat, lalu biaya fallback item; total = |qty| x unit. */
export function normalizeMovement(
  row: MovementDbRow,
  itemId: string,
  item: Pick<StockCardItem, "kode" | "nama" | "kategori"> | undefined,
  fallbackCostByItem: Map<string, number>
) {
  const unitCost = toQty(row.unit_cost) || fallbackCostByItem.get(itemId) || 0;
  const totalCost = toQty(row.total_cost) || Math.abs(toQty(row.jumlah)) * unitCost;
  const kode = item?.kode || "";
  const nama = item?.nama || itemId;
  const kategori = item?.kategori || "-";

  return {
    id: row.id,
    item_id: itemId,
    raw_material_id: itemId,
    material_kode: kode,
    material_nama: nama,
    material_kategori: kategori,
    item_kode: kode,
    item_nama: nama,
    item_kategori: kategori,
    tipe: row.tipe,
    jumlah: toQty(row.jumlah),
    qty_before: toQty(row.qty_before),
    qty_after: toQty(row.qty_after),
    unit_cost: unitCost,
    total_cost: totalCost,
    reference_type: row.reference_type || "-",
    reference_id: row.reference_id || null,
    reference_number: row.reference_number || "-",
    alasan: row.alasan || "-",
    catatan: row.catatan || "",
    created_at: row.created_at,
    warehouse_id: row.warehouse_id || null,
  };
}

export function buildStockCardSummary(
  movements: StockCardMovement[],
  openingBalance: number,
  fallbackClosing: number
) {
  return movements.reduce(
    (acc, movement) => {
      if (movement.tipe === "in") acc.total_in += movement.jumlah;
      if (movement.tipe === "out") acc.total_out += movement.jumlah;
      if (movement.tipe === "return") acc.total_return += movement.jumlah;
      if (movement.tipe === "transfer") acc.total_transfer += movement.jumlah;
      if (movement.tipe === "adjustment") {
        const diff = movement.qty_after - movement.qty_before;
        if (diff >= 0) acc.total_adjustment_in += diff;
        else acc.total_adjustment_out += Math.abs(diff);
      }
      acc.total_value += movement.total_cost || movement.jumlah * movement.unit_cost;
      acc.closing_balance = movement.qty_after;
      return acc;
    },
    {
      opening_balance: openingBalance,
      closing_balance: movements.at(-1)?.qty_after ?? fallbackClosing,
      total_in: 0,
      total_out: 0,
      total_adjustment_in: 0,
      total_adjustment_out: 0,
      total_return: 0,
      total_transfer: 0,
      total_value: 0,
      movement_count: movements.length,
    }
  );
}

const MOVEMENT_COLUMNS = `
      id,
      warehouse_id,
      tipe,
      jumlah,
      qty_before,
      qty_after,
      unit_cost,
      total_cost,
      reference_type,
      reference_id,
      reference_number,
      alasan,
      catatan,
      created_at`;

interface MovementSource {
  table: "inventory_movements" | "finished_goods_movements";
  itemColumn: "raw_material_id" | "product_id";
  /** finished_goods_movements: baris rincian varian (pos_sku_id terisi) dikecualikan. */
  productLevelOnly: boolean;
}

const RAW_MATERIAL_MOVEMENTS: MovementSource = {
  table: "inventory_movements",
  itemColumn: "raw_material_id",
  productLevelOnly: false,
};

// EPIC-047 Fase 1B: baris varian adalah rincian dari baris level produk; jangan
// dihitung dua kali di kartu stok per produk (Fase 1C membacanya per SKU).
const PRODUCT_MOVEMENTS: MovementSource = {
  table: "finished_goods_movements",
  itemColumn: "product_id",
  productLevelOnly: true,
};

interface DateRange {
  from?: string;
  to?: string;
}

async function loadMovements(
  db: DbClient,
  source: MovementSource,
  params: StockCardQuery,
  selectedId: string | undefined,
  range: DateRange
) {
  let query = db
    .from(source.table)
    .select(`${source.itemColumn},${MOVEMENT_COLUMNS}`)
    .eq("is_active", true)
    .order("created_at", { ascending: true })
    .limit(params.limit);

  if (selectedId) query = query.eq(source.itemColumn, selectedId);
  if (params.warehouse_id) query = query.eq("warehouse_id", params.warehouse_id);
  if (params.tipe !== "all") query = query.eq("tipe", params.tipe);
  if (range.from) query = query.gte("created_at", range.from);
  if (range.to) query = query.lte("created_at", range.to);
  if (source.productLevelOnly) query = query.is("pos_sku_id", null);

  const { data, error } = await query;
  if (error) throw error;
  return (data || []) as MovementDbRow[];
}

/** Saldo awal = qty_after movement terakhir sebelum date_from (kalau ada). */
async function loadOpeningBalance(
  db: DbClient,
  source: MovementSource,
  params: StockCardQuery,
  selectedId: string | undefined,
  range: DateRange,
  fallback: number
) {
  if (!selectedId || !range.from) return fallback;

  let query = db
    .from(source.table)
    .select("qty_after")
    .eq(source.itemColumn, selectedId)
    .eq("is_active", true);
  if (source.productLevelOnly) query = query.is("pos_sku_id", null);
  query = query.lt("created_at", range.from).order("created_at", { ascending: false }).limit(1);
  if (params.warehouse_id) query = query.eq("warehouse_id", params.warehouse_id);

  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data ? toQty(data.qty_after) : fallback;
}

async function buildStockCard(
  db: DbClient,
  source: MovementSource,
  params: StockCardQuery,
  selectedId: string | undefined,
  items: StockCardItem[],
  itemById: Map<string, StockCardItem>,
  movementRows: MovementDbRow[],
  fallbackCostByItem: Map<string, number>,
  range: DateRange
) {
  const selectedItem = selectedId ? items.find((item) => item.id === selectedId) || null : null;
  const movements = movementRows.map((row) => {
    const itemId = String(row[source.itemColumn]);
    return normalizeMovement(row, itemId, itemById.get(itemId), fallbackCostByItem);
  });
  const openingBalance = await loadOpeningBalance(
    db,
    source,
    params,
    selectedId,
    range,
    movements[0]?.qty_before || 0
  );

  return {
    items,
    materials: items,
    selected_item: selectedItem,
    selected_material: selectedItem,
    movements,
    summary: buildStockCardSummary(movements, openingBalance, selectedItem?.qty_onhand || 0),
  };
}

const placeholderItem = (row: { id: string; kode?: string | null; nama?: string | null; kategori?: string | null }) =>
  normalizeItem({ ...row, kategori: row.kategori || "-", status_stok: "AMAN" });

async function getRawMaterialStockCard(db: DbClient, params: StockCardQuery, range: DateRange) {
  const selectedId = params.item_id || params.material_id;

  let materialsQuery = db
    .from("v_raw_materials_stock")
    .select("*")
    .eq("is_active", true)
    .order("nama", { ascending: true });
  if (params.search) {
    materialsQuery = materialsQuery.or(`nama.ilike.%${params.search}%,kode.ilike.%${params.search}%`);
  }
  const { data: materialsData, error: materialsError } = await materialsQuery;
  if (materialsError) throw materialsError;

  let materials = ((materialsData || []) as StockItemRow[]).map(normalizeItem);

  if (params.warehouse_id) {
    const { data: invRows, error: invError } = await db
      .from("inventory")
      .select("raw_material_id")
      .eq("warehouse_id", params.warehouse_id)
      .eq("is_active", true);
    if (invError) throw invError;
    const allowed = new Set(((invRows || []) as { raw_material_id: string }[]).map((r) => r.raw_material_id));
    materials = materials.filter((m) => allowed.has(m.id));
  }

  const movementRows = await loadMovements(db, RAW_MATERIAL_MOVEMENTS, params, selectedId, range);
  const movementItemIds = Array.from(new Set(movementRows.map((row) => String(row.raw_material_id))));
  const materialById = new Map(materials.map((material) => [material.id, material]));
  let fallbackCostByItem = new Map<string, number>();

  if (movementItemIds.length > 0) {
    // Bahan di luar daftar (mis. tersaring search/gudang) tetap butuh kode & nama.
    const missingIds = movementItemIds.filter((id) => !materialById.has(id));
    if (missingIds.length > 0) {
      const { data: extraMaterials, error: extraError } = await db
        .from("raw_materials")
        .select("id, kode, nama, kategori")
        .in("id", missingIds)
        .is("deleted_at", null);
      if (extraError) throw extraError;
      for (const row of (extraMaterials || []) as StockItemRow[]) {
        materialById.set(String(row.id), placeholderItem(row));
      }
    }

    const { data: inventoryCosts, error: inventoryCostError } = await db
      .from("inventory")
      .select("raw_material_id, unit_cost")
      .in("raw_material_id", movementItemIds)
      .eq("is_active", true);
    if (inventoryCostError) throw inventoryCostError;
    fallbackCostByItem = new Map(
      ((inventoryCosts || []) as { raw_material_id: string; unit_cost?: Numeric }[]).map((item) => [
        item.raw_material_id,
        toQty(item.unit_cost),
      ])
    );
  }

  return buildStockCard(
    db,
    RAW_MATERIAL_MOVEMENTS,
    params,
    selectedId,
    materials,
    materialById,
    movementRows,
    fallbackCostByItem,
    range
  );
}

interface FinishedGoodsStockRow {
  id?: string | null;
  product_id?: string | null;
  product_kode?: string | null;
  product_nama?: string | null;
  product_kategori?: string | null;
  satuan_nama?: string | null;
  warehouse_id?: string | null;
  warehouse_name?: string | null;
  qty_available?: Numeric;
  unit_cost?: Numeric;
}

async function getProductStockCard(db: DbClient, params: StockCardQuery, range: DateRange) {
  const selectedId = params.item_id || params.product_id;

  let productsQuery = db
    .from("v_finished_goods_stock")
    .select("*")
    .eq("is_active", true)
    .order("product_nama", { ascending: true });
  if (params.warehouse_id) productsQuery = productsQuery.eq("warehouse_id", params.warehouse_id);
  if (params.search) {
    productsQuery = productsQuery.or(
      `product_nama.ilike.%${params.search}%,product_kode.ilike.%${params.search}%`
    );
  }
  const { data: productsData, error: productsError } = await productsQuery;
  if (productsError) throw productsError;

  const items = ((productsData || []) as FinishedGoodsStockRow[]).map((row) =>
    normalizeItem({
      id: String(row.product_id || row.id),
      kode: row.product_kode,
      nama: row.product_nama,
      kategori: row.product_kategori,
      satuan: row.satuan_nama,
      lokasi_rak: row.warehouse_name,
      qty_onhand: row.qty_available,
      avg_cost: row.unit_cost,
      min_stock: 0,
      max_stock: null,
      status_stok: "AMAN",
      warehouse_id: row.warehouse_id,
      warehouse_name: row.warehouse_name,
    })
  );

  const movementRows = await loadMovements(db, PRODUCT_MOVEMENTS, params, selectedId, range);
  return buildStockCard(
    db,
    PRODUCT_MOVEMENTS,
    params,
    selectedId,
    items,
    new Map(items.map((item) => [item.id, item])),
    movementRows,
    new Map(items.map((item) => [item.id, item.avg_cost])),
    range
  );
}

export async function getStockCard(db: DbClient, params: StockCardQuery) {
  const range: DateRange = {
    from: params.date_from ? dayStartIso(params.date_from) : undefined,
    to: params.date_to ? dayEndIso(params.date_to) : undefined,
  };
  return params.item_type === "product"
    ? getProductStockCard(db, params, range)
    : getRawMaterialStockCard(db, params, range);
}
