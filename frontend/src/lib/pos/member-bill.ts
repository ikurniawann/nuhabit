/**
 * Tagihan Member (owner 2026-10-01) — model deposit: cicilan dicatat di akun
 * member tanpa menunjuk order; saat saldo cicilan menutup SEMUA order
 * terbuka, order-order itu ditutup sekaligus. Modul ini murni (tanpa DB).
 */

import { cashierMethodFromHandler, isDrawerCashMethod, isFocPaymentMethod } from "@/lib/pos/payment-methods";

/** Metode bayar POS yang boleh dipakai mencicil (bukan saldo/tab khusus). */
export const MEMBER_BILL_HANDLERS = ["cash", "qris", "credit"] as const;
export type MemberBillHandler = (typeof MEMBER_BILL_HANDLERS)[number];

export function isMemberBillHandler(handler: string): handler is MemberBillHandler {
  return (MEMBER_BILL_HANDLERS as readonly string[]).includes(handler);
}

/** Metode yang tampil/diterima utk cicilan: handler biasa, bukan FOC (gratis). */
export function isMemberBillMethod(method: { handler: string; code: string; name: string }) {
  return isMemberBillHandler(method.handler) && !isFocPaymentMethod(method.code, method.name);
}

/** Kode dasar yang disimpan di payment_method (sama dengan alur kasir). */
export function memberBillBaseMethod(handler: MemberBillHandler) {
  return cashierMethodFromHandler(handler);
}

export type MemberBillBalance = {
  /** Σ total order terbuka (belum lunas). */
  openTotal: number;
  /** Saldo cicilan yang belum dipakai menutup order. */
  credit: number;
  /** Sisa yang harus dibayar (≥ 0). */
  outstanding: number;
  /** Saldo cicilan melebihi order terbuka (mis. ada order di-void). */
  surplus: number;
  /** Order terbuka sudah tertutup penuh oleh saldo → siap ditutup. */
  canSettle: boolean;
};

const round2 = (value: number) => Math.round((Number(value) || 0) * 100) / 100;

export function computeMemberBillBalance(input: {
  openTotal: number;
  paymentsTotal: number;
  settledTotal: number;
}): MemberBillBalance {
  const openTotal = round2(Math.max(0, input.openTotal));
  const credit = round2(Math.max(0, input.paymentsTotal - input.settledTotal));
  const diff = round2(openTotal - credit);
  return {
    openTotal,
    credit,
    outstanding: Math.max(0, diff),
    surplus: Math.max(0, -diff),
    canSettle: openTotal > 0 && diff <= 0,
  };
}

/** Nominal cicilan valid: > 0, kelipatan rupiah, tidak melebihi sisa tagihan. */
export function validateMemberBillAmount(amount: unknown, outstanding: number): string | null {
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) return "Nominal bayar harus lebih dari 0";
  if (Math.round(value) !== value) return "Nominal bayar harus bilangan rupiah bulat";
  if (outstanding <= 0) return "Tidak ada sisa tagihan untuk dibayar";
  if (value > outstanding + 0.005) return "Nominal melebihi sisa tagihan";
  return null;
}

/** Event jurnal cicilan per metode dasar (Kas/Bank ↔ Uang Muka Member). */
export function memberDepositEvent(baseMethod: string) {
  const value = String(baseMethod || "").toLowerCase();
  if (value === "cash") return "POS_MEMBER_DEPOSIT_CASH" as const;
  if (value === "qris") return "POS_MEMBER_DEPOSIT_QRIS" as const;
  if (value === "credit_card" || value === "credit" || value === "debit") {
    return "POS_MEMBER_DEPOSIT_CARD" as const;
  }
  return null;
}

/** payment_method order yang ditutup lewat Tagihan Member. */
export const MEMBER_BILL_PAYMENT_METHOD = "member_bill";
export const MEMBER_BILL_PAYMENT_LABEL = "Tagihan Member";

export type MemberBillShiftTotals = { cash: number; qris: number; card: number; total: number };

/**
 * Cicilan tagihan member yang diterima dalam satu shift. Tunai laci menambah
 * kas yang diharapkan saat tutup shift; bukan penjualan (penjualan diakui saat
 * order ditutup, dengan metode 'member_bill' yang tidak dihitung lagi di shift).
 */
export function summarizeMemberBillShiftPayments(
  rows: Array<{ amount: number | string; payment_method: string | null; payment_method_code?: string | null }>
): MemberBillShiftTotals {
  const totals: MemberBillShiftTotals = { cash: 0, qris: 0, card: 0, total: 0 };
  for (const row of rows) {
    const amount = Number(row.amount) || 0;
    const method = String(row.payment_method || "").toLowerCase();
    totals.total += amount;
    if (method === "cash" && isDrawerCashMethod({ paymentMethod: method, paymentMethodCode: row.payment_method_code })) {
      totals.cash += amount;
    } else if (method === "qris") {
      totals.qris += amount;
    } else {
      totals.card += amount;
    }
  }
  return totals;
}
