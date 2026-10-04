
// Keterangan prorata utk slip gaji: dari kolom payroll_details.prorate_factor
// + full_base_salary. pg numeric datang sebagai string; 1 (atau nyaris 1) =
// periode penuh → tanpa nota.

import { formatRupiah } from "@/lib/format";

const FULL_PERIOD_EPSILON = 0.0005;

/** Faktor proraté ternormalisasi (0..1); null bila tidak valid/periode penuh. */
export function parseProrateFactor(
  raw: number | string | null | undefined
): number | null {
  if (raw === null || raw === undefined) return null;
  const factor = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(factor)) return null;
  if (factor <= 0 || factor >= 1 - FULL_PERIOD_EPSILON) return null;
  return factor;
}

export interface ProrateInput {
  /** payroll_details.prorate_factor */
  factor: number | string | null | undefined;
  /** payroll_details.full_base_salary (snapshot gaji penuh; null utk baris lama) */
  fullBase: number | string | null | undefined;
  /** payroll_details.base_salary (gaji pokok terproraté yang dibayar) */
  paidBase: number | string | null | undefined;
}

export interface ProrateBreakdown {
  factor: number;
  /** Gaji pokok penuh (snapshot; atau derivasi paid/factor utk baris lama) */
  fullBase: number;
  /** Persen dibayar, format id-ID, mis. "51,6" */
  paidPct: string;
  /** Persen dipotong, format id-ID, mis. "48,4" */
  cutPct: string;
}

const toNumber = (raw: number | string | null | undefined): number | null => {
  if (raw === null || raw === undefined) return null;
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
};

const fmtPct = (v: number): string =>
  v.toLocaleString("id-ID", { maximumFractionDigits: 1 });

/** Rincian prorata utk tampilan slip; null bila periode penuh/tak valid. */
export function prorateBreakdown(input: ProrateInput): ProrateBreakdown | null {
  const factor = parseProrateFactor(input.factor);
  if (factor === null) return null;
  const paidBase = toNumber(input.paidBase);
  const fullBase =
    toNumber(input.fullBase) ??
    (paidBase !== null ? Math.round(paidBase / factor) : null);
  if (fullBase === null) return null;
  const paidPctVal = factor * 100;
  return {
    factor,
    fullBase,
    paidPct: fmtPct(paidPctVal),
    cutPct: fmtPct(100 - paidPctVal),
  };
}

/**
 * Kalimat keterangan prorata utk slip, atau null bila gaji periode penuh.
 * Menyebut gaji pokok penuh + persen dibayar/dipotong agar tidak ambigu.
 */
export function prorateNote(input: ProrateInput): string | null {
  const b = prorateBreakdown(input);
  if (b === null) return null;
  return `Prorata dari gaji pokok penuh ${formatRupiah(b.fullBase)} — dibayar ${b.paidPct}%, dipotong ${b.cutPct}% (cakupan kontrak tidak satu periode penuh)`;
}
