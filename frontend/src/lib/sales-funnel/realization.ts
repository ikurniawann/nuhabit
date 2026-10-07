/**
 * Realisasi quotation (EPIC-022 Fase F3), bagian pure: kebutuhan bahan vs
 * stok gudang venue → kekurangan, lalu rencana potong stok per baris gudang.
 */

export interface MaterialRequirement {
  raw_material_id: string;
  needed: number;
}

export interface StockRow {
  id: string;
  raw_material_id: string;
  warehouse_id: string | null;
  qty_available: number;
}

export interface Shortfall {
  raw_material_id: string;
  needed: number;
  available: number;
}

export interface StockDeduction {
  inventory_id: string;
  raw_material_id: string;
  warehouse_id: string | null;
  take: number;
  before: number;
  after: number;
}

/** Presisi kolom stok numeric(15,3) — drift float string→Number jangan memblokir stok yang persis cukup. */
const to3dp = (value: number) => Math.round(value * 1000) / 1000;
const to4dp = (value: number) => Math.round(value * 10000) / 10000;
const to2dp = (value: number) => Math.round(value * 100) / 100;

/** Bahan yang stok total venue-nya kurang dari kebutuhan (angka tampil 2 desimal). */
export function findShortfalls(requirements: MaterialRequirement[], stock: StockRow[]): Shortfall[] {
  const available = new Map<string, number>();
  for (const row of stock) {
    available.set(row.raw_material_id, (available.get(row.raw_material_id) ?? 0) + row.qty_available);
  }
  return requirements.flatMap((req) => {
    const needed = to3dp(req.needed);
    const have = to3dp(available.get(req.raw_material_id) ?? 0);
    return have < needed ? [{ raw_material_id: req.raw_material_id, needed: to2dp(needed), available: to2dp(have) }] : [];
  });
}

/** Potong greedy per baris gudang (stok terbesar dulu); dipanggil setelah findShortfalls kosong. */
export function planDeductions(requirements: MaterialRequirement[], stock: StockRow[]): StockDeduction[] {
  const deductions: StockDeduction[] = [];
  for (const req of requirements) {
    let remaining = to3dp(req.needed);
    const rows = stock
      .filter((row) => row.raw_material_id === req.raw_material_id)
      .sort((a, b) => b.qty_available - a.qty_available);
    for (const row of rows) {
      if (remaining <= 0) break;
      const take = Math.min(row.qty_available, remaining);
      if (take <= 0) continue;
      deductions.push({
        inventory_id: row.id,
        raw_material_id: req.raw_material_id,
        warehouse_id: row.warehouse_id,
        take,
        before: row.qty_available,
        after: to4dp(row.qty_available - take),
      });
      remaining = to4dp(remaining - take);
    }
  }
  return deductions;
}
