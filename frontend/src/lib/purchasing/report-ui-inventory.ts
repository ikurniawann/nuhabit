import type { BreakdownInput } from "./report-ui-shared";
import type { InventoryApiRow } from "./report-ui-types";

export type StockStatus = "normal" | "warning" | "critical" | "empty";

export const STOCK_STATUS_LABELS: Record<StockStatus, string> = {
  normal: "Normal",
  warning: "Warning",
  critical: "Critical",
  empty: "Kosong",
};

const CATEGORY_LABELS: Record<string, string> = {
  BAHAN_PANGAN: "Bahan Pangan",
  BAHAN_NON_PANGAN: "Bahan Non-Pangan",
  KEMASAN: "Kemasan",
  BAHAN_BAKAR: "Bahan Bakar",
  LAINNYA: "Lainnya",
};

export interface InventoryRow {
  id: string;
  kode?: string;
  nama?: string;
  kategori: string;
  lokasi_rak?: string;
  qty_in_stock: number;
  minimum_stock: number;
  maximum_stock?: number;
  avg_unit_cost: number;
  stock_status: StockStatus;
  satuan?: string;
}

/** Kosong bila 0; critical ≤ 25% stok minimum; warning ≤ stok minimum. */
export function stockStatus(qty: number, minStock: number): StockStatus {
  if (qty === 0) return "empty";
  if (minStock > 0 && qty <= minStock * 0.25) return "critical";
  if (minStock > 0 && qty <= minStock) return "warning";
  return "normal";
}

export function toInventoryRow(item: InventoryApiRow): InventoryRow {
  const qty = Number(item.qty_onhand || 0);
  const minStock = Number(item.min_stock ?? item.stok_minimum ?? 0);
  const rawCategory = item.kategori || "LAINNYA";
  return {
    id: item.id || item.raw_material_id || "",
    kode: item.kode,
    nama: item.nama,
    kategori: CATEGORY_LABELS[rawCategory] || rawCategory,
    lokasi_rak: item.lokasi_rak,
    qty_in_stock: qty,
    minimum_stock: minStock,
    maximum_stock: item.max_stock ?? item.stok_maximum ?? undefined,
    avg_unit_cost: Number(item.avg_cost ?? item.unit_cost ?? 0),
    stock_status: stockStatus(qty, minStock),
    satuan: item.satuan || item.satuan_besar_nama,
  };
}

export const inventoryValue = (row: InventoryRow) => row.qty_in_stock * (row.avg_unit_cost || 0);

export function filterInventory(rows: InventoryRow[], search: string, kategori: string): InventoryRow[] {
  const keyword = search.trim().toLowerCase();
  return rows.filter(
    (row) =>
      (!keyword || row.kode?.toLowerCase().includes(keyword) || row.nama?.toLowerCase().includes(keyword)) &&
      (kategori === "all" || row.kategori === kategori)
  );
}

export function inventoryCategories(rows: InventoryRow[]): string[] {
  return [...new Set(rows.map((row) => row.kategori).filter(Boolean))].sort((a, b) => a.localeCompare(b, "id"));
}

export function summarizeInventory(rows: InventoryRow[]) {
  return {
    totalValue: rows.reduce((sum, row) => sum + inventoryValue(row), 0),
    totalQty: rows.reduce((sum, row) => sum + row.qty_in_stock, 0),
    warningCount: rows.filter((row) => row.stock_status === "warning").length,
    criticalCount: rows.filter((row) => row.stock_status === "critical" || row.stock_status === "empty").length,
  };
}

/** Nilai stok per kategori, terbesar dulu. */
export function inventoryCategoryBreakdown(rows: InventoryRow[]): BreakdownInput[] {
  const byCategory = new Map<string, { count: number; value: number }>();
  for (const row of rows) {
    const category = row.kategori || "Lainnya";
    const entry = byCategory.get(category) ?? { count: 0, value: 0 };
    entry.count += 1;
    entry.value += inventoryValue(row);
    byCategory.set(category, entry);
  }
  return [...byCategory.entries()]
    .sort((a, b) => b[1].value - a[1].value)
    .map(([category, { count, value }]) => ({ key: category, label: category, caption: `${count} item`, value }));
}

export const INVENTORY_CSV_HEADERS = [
  "Kode",
  "Nama",
  "Kategori",
  "Lokasi",
  "Stok",
  "Satuan",
  "Min",
  "Max",
  "Unit Cost",
  "Nilai Total",
  "Status",
];

export function inventoryCsvRows(rows: InventoryRow[]): string[][] {
  return rows.map((row) => [
    row.kode || "",
    row.nama || "",
    row.kategori || "",
    row.lokasi_rak || "",
    String(row.qty_in_stock),
    row.satuan || "",
    String(row.minimum_stock),
    String(row.maximum_stock ?? ""),
    String(row.avg_unit_cost),
    String(inventoryValue(row)),
    STOCK_STATUS_LABELS[row.stock_status],
  ]);
}
