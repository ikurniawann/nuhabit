/**
 * Batch & kedaluwarsa (port domain/batches.go NüHabit).
 *
 * Aturan keluar barang adalah FEFO (first expired, first out), bukan FIFO:
 * barang yang datang belakangan bisa kedaluwarsa lebih dulu. Konsumsi riil di
 * database dijalankan trigger inventory.fn_inventory_movement_batches dengan
 * urutan yang sama; fungsi di sini dipakai untuk pratinjau, laporan, dan tes.
 */

export type ExpiryState = "none" | "fresh" | "near" | "expired";

export interface StockBatch {
  id: string;
  batchNumber: string | null;
  /** YYYY-MM-DD, null = tanpa tanggal (tidak pernah kedaluwarsa). */
  expiryDate: string | null;
  qtyRemaining: number;
  unitCost: number;
  /** ISO timestamp; urutan kedatangan sebagai pemecah seri. */
  receivedAt: string;
}

export interface BatchAllocation {
  batchId: string;
  batchNumber: string | null;
  expiryDate: string | null;
  qty: number;
  qtyBefore: number;
  qtyAfter: number;
  unitCost: number;
}

export interface FefoOutcome {
  allocations: BatchAllocation[];
  /** Qty yang tidak tertutup batch mana pun. */
  shortfall: number;
  /** Nilai barang yang dialokasikan, per batch. */
  cost: number;
  /** Batch kedaluwarsa yang dilewati (dilaporkan, tidak dikonsumsi diam-diam). */
  expired: string[];
}

const DAY_MS = 86_400_000;

export function roundQty(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function dateToUtcMs(date: string): number {
  const [y, m, d] = date.slice(0, 10).split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

/** Selisih hari kalender `to - from` (negatif bila `to` sudah lewat). */
export function daysBetween(from: string, to: string): number {
  return Math.round((dateToUtcMs(to) - dateToUtcMs(from)) / DAY_MS);
}

export function addDays(date: string, days: number): string {
  return new Date(dateToUtcMs(date) + days * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Kolom DATE dari driver pg datang sebagai Date (tengah malam waktu lokal
 * proses); string dipotong ke YYYY-MM-DD.
 */
export function toDateOnly(value: unknown): string | null {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  }
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  return null;
}

/** Tanggal hari ini di zona Asia/Jakarta (YYYY-MM-DD). */
export function todayJakarta(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function daysUntilExpiry(batch: Pick<StockBatch, "expiryDate">, today: string): number | null {
  return batch.expiryDate ? daysBetween(today, batch.expiryDate) : null;
}

export function expiryState(
  batch: Pick<StockBatch, "expiryDate">,
  today: string,
  warningDays: number
): ExpiryState {
  const days = daysUntilExpiry(batch, today);
  if (days === null) return "none";
  if (days < 0) return "expired";
  if (days <= warningDays) return "near";
  return "fresh";
}

/**
 * Tanggal kedaluwarsa bawaan saat supplier tidak memberi tanggal: tanggal
 * terima + shelf_life_days bahan baku. Null bila shelf life tidak diisi.
 */
export function defaultExpiryDate(
  receivedOn: string,
  shelfLifeDays: number | null | undefined
): string | null {
  const days = Number(shelfLifeDays);
  if (!Number.isFinite(days) || days <= 0) return null;
  return addDays(receivedOn, Math.floor(days));
}

/** Urutan keluar rak: tanggal terdekat dulu, tanpa tanggal terakhir, lalu urutan datang. */
export function sortFefo<T extends Pick<StockBatch, "expiryDate" | "receivedAt">>(batches: T[]): T[] {
  return [...batches].sort((a, b) => {
    if (a.expiryDate !== b.expiryDate) {
      if (a.expiryDate === null) return 1;
      if (b.expiryDate === null) return -1;
      return a.expiryDate < b.expiryDate ? -1 : 1;
    }
    return a.receivedAt.localeCompare(b.receivedAt);
  });
}

/**
 * Tentukan batch mana yang menanggung pengeluaran `qty`.
 * Batch kedaluwarsa dilewati dan dilaporkan; sisa yang tak tertutup = shortfall.
 */
export function allocateFefo(batches: StockBatch[], qty: number, today: string): FefoOutcome {
  const outcome: FefoOutcome = { allocations: [], shortfall: 0, cost: 0, expired: [] };
  let remaining = roundQty(qty);
  if (remaining <= 0) return outcome;

  const usable: StockBatch[] = [];
  for (const batch of batches) {
    if (batch.qtyRemaining <= 0) continue;
    if (expiryState(batch, today, 0) === "expired") {
      outcome.expired.push(batch.id);
      continue;
    }
    usable.push(batch);
  }

  for (const batch of sortFefo(usable)) {
    if (remaining <= 0) break;
    const take = roundQty(Math.min(batch.qtyRemaining, remaining));
    outcome.allocations.push({
      batchId: batch.id,
      batchNumber: batch.batchNumber,
      expiryDate: batch.expiryDate,
      qty: take,
      qtyBefore: batch.qtyRemaining,
      qtyAfter: roundQty(batch.qtyRemaining - take),
      unitCost: batch.unitCost,
    });
    outcome.cost += take * batch.unitCost;
    remaining = roundQty(remaining - take);
  }

  outcome.shortfall = remaining;
  outcome.cost = roundMoney(outcome.cost);
  return outcome;
}

export interface ExpirySummary {
  nearBatches: number;
  nearQty: number;
  nearValue: number;
  expiredBatches: number;
  expiredQty: number;
  expiredValue: number;
}

/** Nilai stok yang hampir dan sudah kedaluwarsa. `valueCost` = biaya rata-rata per unit. */
export function summarizeExpiry(
  batches: (Pick<StockBatch, "expiryDate" | "qtyRemaining"> & { valueCost: number })[],
  today: string,
  warningDays: number
): ExpirySummary {
  const summary: ExpirySummary = {
    nearBatches: 0,
    nearQty: 0,
    nearValue: 0,
    expiredBatches: 0,
    expiredQty: 0,
    expiredValue: 0,
  };
  for (const batch of batches) {
    if (batch.qtyRemaining <= 0) continue;
    const value = batch.qtyRemaining * batch.valueCost;
    const state = expiryState(batch, today, warningDays);
    if (state === "near") {
      summary.nearBatches += 1;
      summary.nearQty += batch.qtyRemaining;
      summary.nearValue += value;
    } else if (state === "expired") {
      summary.expiredBatches += 1;
      summary.expiredQty += batch.qtyRemaining;
      summary.expiredValue += value;
    }
  }
  summary.nearQty = roundQty(summary.nearQty);
  summary.expiredQty = roundQty(summary.expiredQty);
  summary.nearValue = roundMoney(summary.nearValue);
  summary.expiredValue = roundMoney(summary.expiredValue);
  return summary;
}
