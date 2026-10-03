import { roundQty } from "@/lib/inventory/batches";

/**
 * Saran pemesanan ulang (port ReorderQuantity, domain/inventory.go NüHabit).
 */

export interface StockLevel {
  onHand: number;
  onOrder: number;
  minimum: number;
  /** null/0 = tidak ada stok maksimum. */
  maximum: number | null;
}

/**
 * Pesan sampai stok maksimum (atau minimum bila maksimum lebih kecil), dikurangi
 * stok di tangan dan yang sudah dipesan. Tidak pernah negatif.
 */
export function reorderQuantity(level: StockLevel): number {
  const target = Math.max(level.minimum, level.maximum ?? 0);
  const needed = target - (level.onHand + level.onOrder);
  return needed <= 0 ? 0 : roundQty(needed);
}

export interface ReorderSuggestion {
  shortage: number;
  suggestedQty: number;
  basis: "maximum" | "minimum_buffer";
}

/**
 * Saran order laporan stok rendah. Dengan stok maksimum: `reorderQuantity`.
 * Tanpa maksimum: aturan lama (kekurangan x 1,5, atau minimum bila tidak kurang).
 */
export function suggestReorder(level: StockLevel): ReorderSuggestion {
  const shortage = Math.max(0, roundQty(level.minimum - level.onHand));
  if (level.maximum !== null && level.maximum > 0) {
    return { shortage, suggestedQty: reorderQuantity(level), basis: "maximum" };
  }
  return {
    shortage,
    suggestedQty: shortage > 0 ? Math.ceil(shortage * 1.5) : level.minimum,
    basis: "minimum_buffer",
  };
}
