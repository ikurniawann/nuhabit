// Matematika ledger tab dua arah (EPIC-023 Fase B). Fungsi murni tanpa DB:
// debit = tagihan (tiket/fnb/denda/koreksi/refund-deposit), kredit = uang
// masuk (deposit/pembayaran) + potongan promo (diskon, EPIC-032 B1).
// Amount di ledger selalu positif; arah dari direction. Semua nominal
// dibulatkan 2dp agar bebas drift float.

import { formatRupiah } from "@/lib/format";

export const CHARGE_TYPES = [
  "tiket",
  "fnb",
  "denda",
  "koreksi",
  "refund-deposit",
  "deposit",
  "pembayaran",
  // EPIC-032: potongan promo — kredit non-uang agar visit ber-diskon tetap
  // net-0 (debit gross = pembayaran net + diskon)
  "diskon",
] as const;
export type ChargeType = (typeof CHARGE_TYPES)[number];

export type ChargeDirection = "debit" | "kredit";

/** Arah baku per jenis charge — uang masuk/potongan kredit, selain itu debit. */
export function directionForChargeType(type: ChargeType): ChargeDirection {
  return type === "deposit" || type === "pembayaran" || type === "diskon"
    ? "kredit"
    : "debit";
}

export interface TabEntry {
  direction: ChargeDirection;
  amount: number;
}

export interface TabSummary {
  /** Total tagihan + refund (sisi debit). */
  debit: number;
  /** Total uang masuk (sisi kredit). */
  kredit: number;
  /** Sisa tagihan postpaid = debit − kredit (bisa negatif bila lebih bayar). */
  outstanding: number;
  /** Saldo prepaid = kredit − debit. */
  saldo: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function computeTabSummary(entries: readonly TabEntry[]): TabSummary {
  let debit = 0;
  let kredit = 0;
  for (const e of entries) {
    if (e.direction === "debit") debit += e.amount;
    else kredit += e.amount;
  }
  debit = round2(debit);
  kredit = round2(kredit);
  return {
    debit,
    kredit,
    outstanding: round2(debit - kredit),
    saldo: round2(kredit - debit),
  };
}

/**
 * Guard charge baru per mode bayar — WAJIB ditegakkan server sebelum
 * menulis baris debit (tiket/fnb/denda).
 */
export function canCharge(input: {
  paymentMode: "postpaid" | "prepaid";
  summary: TabSummary;
  amount: number;
  creditLimit: number | null;
}): { ok: true } | { ok: false; reason: string } {
  const amount = round2(input.amount);
  if (amount <= 0) return { ok: false, reason: "Nominal charge harus > 0" };

  if (input.paymentMode === "prepaid") {
    const sisa = round2(input.summary.saldo - amount);
    if (sisa < 0) {
      return {
        ok: false,
        reason: `Saldo tidak cukup (saldo ${formatRupiah(input.summary.saldo)}) — silakan top-up dulu`,
      };
    }
    return { ok: true };
  }

  const limit = input.creditLimit;
  if (limit !== null) {
    const after = round2(input.summary.outstanding + amount);
    if (after > limit) {
      return {
        ok: false,
        reason: `Melewati plafon tagihan ${formatRupiah(limit)} — silakan bayar parsial di kasir`,
      };
    }
  }
  return { ok: true };
}

/**
 * Rencana settlement penutup visit: baris ledger yang harus ditulis agar
 * debit = kredit (ledger seimbang). Postpaid → butuh pembayaran senilai
 * outstanding; prepaid → refund sisa saldo (atau pembayaran kekurangan
 * bila saldo minus akibat denda).
 */
export function settlementPlan(summary: TabSummary): {
  /** Nominal yang harus dibayar pengunjung (kredit `pembayaran`). */
  amountDue: number;
  /** Nominal dikembalikan ke pengunjung (debit `refund-deposit`). */
  refundAmount: number;
} {
  if (summary.outstanding > 0) {
    return { amountDue: summary.outstanding, refundAmount: 0 };
  }
  if (summary.outstanding < 0) {
    return { amountDue: 0, refundAmount: round2(-summary.outstanding) };
  }
  return { amountDue: 0, refundAmount: 0 };
}

/** Ledger seimbang = visit boleh ditutup. */
export function isBalanced(summary: TabSummary): boolean {
  return summary.outstanding === 0;
}
