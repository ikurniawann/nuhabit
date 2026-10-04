import { isDrawerCashMethod } from "@/lib/pos/payment-methods";

export type ShiftOrderRow = {
  total_amount?: number | string | null;
  ark_coins_used?: number | string | null;
  payment_method?: string | null;
  payment_method_code?: string | null;
};

export type ShiftOrderTotals = {
  cash: number;
  qris: number;
  debit: number;
  credit: number;
  arkCoin: number;
  /** Volume F&B yang pindah ke tab ticketing (EPIC-023): bukan uang masuk shift, hanya laporan. */
  nfcTab: number;
};

/**
 * Total penjualan shift per metode. Setiap baris pos_orders = pendapatan stall
 * (total pos_checkouts tidak pernah ditambahkan). Metode 'cash' dengan kode
 * katalog custom (mis. Transfer BCA) bukan uang laci → masuk kolom kartu/credit.
 */
export function summarizeShiftOrders(rows: ShiftOrderRow[]): ShiftOrderTotals {
  const totals: ShiftOrderTotals = { cash: 0, qris: 0, debit: 0, credit: 0, arkCoin: 0, nfcTab: 0 };
  for (const row of rows) {
    const amount = Number(row.total_amount) || 0;
    const method = (row.payment_method || "cash").toLowerCase();
    if (method === "cash" && !isDrawerCashMethod({ paymentMethod: method, paymentMethodCode: row.payment_method_code })) {
      totals.credit += amount;
      continue;
    }
    if (method === "cash") totals.cash += amount;
    else if (method === "qris") totals.qris += amount;
    else if (method === "debit") totals.debit += amount;
    else if (method === "credit") totals.credit += amount;
    else if (method === "ark_coin") totals.arkCoin += Number(row.ark_coins_used) || 0;
    else if (method === "nfc_tab") totals.nfcTab += amount;
  }
  return totals;
}
