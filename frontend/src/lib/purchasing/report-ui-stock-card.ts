import { formatDateTime } from "@/lib/format";
import type {
  StockCardItemType,
  StockCardSummary,
  StockMovement,
  StockMovementType,
} from "./report-ui-types";

export const MOVEMENT_TYPE_LABELS: Record<StockMovementType, string> = {
  all: "Semua Tipe",
  in: "Masuk",
  out: "Keluar",
  adjustment: "Adjustment",
  transfer: "Transfer",
  return: "Retur",
};

export const MOVEMENT_TYPE_STYLES: Record<Exclude<StockMovementType, "all">, string> = {
  in: "border-emerald-200/80 bg-emerald-50 text-emerald-700",
  out: "border-red-200/80 bg-red-50 text-red-700",
  adjustment: "border-amber-200/80 bg-amber-50 text-amber-700",
  transfer: "border-sky-200/80 bg-sky-50 text-sky-700",
  return: "border-violet-200/80 bg-violet-50 text-violet-700",
};

/** Perubahan stok bertanda; bila before/after sama (data lama), pakai jumlah dengan tanda dari tipe. */
export function movementDelta(movement: StockMovement): number {
  const diff = movement.qty_after - movement.qty_before;
  if (diff === 0) return movement.tipe === "out" ? -movement.jumlah : movement.jumlah;
  return diff;
}

export function stockCardTotals(summary?: StockCardSummary) {
  return {
    totalIn: (summary?.total_in || 0) + (summary?.total_adjustment_in || 0) + (summary?.total_return || 0),
    totalOut: (summary?.total_out || 0) + (summary?.total_adjustment_out || 0),
  };
}

export type StockCardUrlFilters = { itemType: StockCardItemType; selectedItem: string; warehouseId: string };

/**
 * Filter awal dari query string (link kartu stok dari halaman lain):
 * `material_id` / `product_id` memilih item, `item_type=product`, `warehouse_id`.
 */
export function stockCardFiltersFromUrl(params: Pick<URLSearchParams, "get">): StockCardUrlFilters {
  const materialId = params.get("material_id");
  const productId = params.get("product_id");
  let itemType: StockCardItemType = params.get("item_type") === "product" || productId ? "product" : "raw_material";
  let selectedItem = "all";
  if (materialId) {
    itemType = "raw_material";
    selectedItem = materialId;
  }
  if (productId) {
    itemType = "product";
    selectedItem = productId;
  }
  return { itemType, selectedItem, warehouseId: params.get("warehouse_id") || "all" };
}

export const STOCK_CARD_CSV_HEADERS = [
  "Tanggal",
  "Kode Item",
  "Nama Item",
  "Tipe",
  "Ref",
  "Alasan",
  "Qty Before",
  "Mutasi",
  "Qty After",
  "Unit Cost",
  "Total Cost",
  "Catatan",
];

export function stockCardCsvRows(movements: StockMovement[]): string[][] {
  return movements.map((movement) => [
    formatDateTime(movement.created_at),
    movement.item_kode || movement.material_kode,
    movement.item_nama || movement.material_nama,
    MOVEMENT_TYPE_LABELS[movement.tipe],
    movement.reference_number,
    movement.alasan,
    String(movement.qty_before),
    String(movementDelta(movement)),
    String(movement.qty_after),
    String(movement.unit_cost),
    String(movement.total_cost),
    movement.catatan,
  ]);
}
