/**
 * Ringkasan penjualan untuk laporan transaksi POS (modul murni, tanpa I/O).
 *
 * Definisi yang dipakai seluruh laporan (permintaan owner 2026-08-15):
 *   Revenue = Σ subtotal   — nilai barang SEBELUM diskon/pajak/service
 *   Diskon  = Σ discount_amount
 *   Pajak   = Σ tax_amount
 *   Service = Σ service_charge_amount
 *   Nett    = Σ total_amount — yang benar-benar dibayar pelanggan
 *
 * Nett sengaja TIDAK dihitung ulang dari komponen: uang masuk adalah fakta;
 * bila data historis tidak konsisten (order lama tanpa subtotal), identitas
 * Revenue − Diskon + Pajak + Service ≠ Nett menjadi terlihat oleh pembaca —
 * itu sinyal kualitas data, bukan sesuatu yang boleh ditutupi pembulatan.
 */

export interface SalesRow {
  subtotal: number | string | null;
  discount_amount: number | string | null;
  tax_amount: number | string | null;
  service_charge_amount: number | string | null;
  total_amount: number | string | null;
  ark_coins_used?: number | string | null;
  stall_code?: string | null;
  stall_name?: string | null;
}

export interface SalesSummary {
  transactions: number;
  revenue: number;
  discount: number;
  tax: number;
  service: number;
  nett: number;
  ark_used: number;
}

const num = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const round2 = (value: number): number => Math.round(value * 100) / 100;

export function summarizeSales(rows: SalesRow[]): SalesSummary {
  const acc = rows.reduce(
    (s, row) => {
      s.transactions += 1;
      s.revenue += num(row.subtotal);
      s.discount += num(row.discount_amount);
      s.tax += num(row.tax_amount);
      s.service += num(row.service_charge_amount);
      s.nett += num(row.total_amount);
      s.ark_used += num(row.ark_coins_used);
      return s;
    },
    { transactions: 0, revenue: 0, discount: 0, tax: 0, service: 0, nett: 0, ark_used: 0 }
  );
  return {
    transactions: acc.transactions,
    revenue: round2(acc.revenue),
    discount: round2(acc.discount),
    tax: round2(acc.tax),
    service: round2(acc.service),
    nett: round2(acc.nett),
    ark_used: round2(acc.ark_used),
  };
}

export interface StallSummary extends SalesSummary {
  stall_code: string | null;
  stall_name: string;
}

/** Rekap per stall, urut nett terbesar. Order tanpa stall tetap tampil. */
export function aggregatePerStall(rows: SalesRow[]): StallSummary[] {
  const byStall = new Map<string, SalesRow[]>();
  for (const row of rows) {
    const key = row.stall_code ?? row.stall_name ?? "__none__";
    const bucket = byStall.get(key) ?? [];
    bucket.push(row);
    byStall.set(key, bucket);
  }

  return Array.from(byStall.entries())
    .map(([key, bucket]) => ({
      stall_code: key === "__none__" ? null : bucket[0].stall_code ?? null,
      stall_name: bucket[0].stall_name ?? (key === "__none__" ? "Tanpa Stall" : key),
      ...summarizeSales(bucket),
    }))
    .sort((a, b) => b.nett - a.nett);
}
