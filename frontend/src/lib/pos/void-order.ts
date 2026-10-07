/** Aturan void POS — termasuk order yang sudah lunas (otorisasi supervisor). */

const BLOCKED_VOID_STATUSES = new Set(["cancelled", "voided", "merged"]);

export function canVoidOrderStatus(status?: string | null): boolean {
  return !BLOCKED_VOID_STATUSES.has(String(status || "").toLowerCase());
}

export function isPaidPosOrder(input: {
  status?: string | null;
  payment_status?: string | null;
}): boolean {
  const status = String(input.status || "").toLowerCase();
  const payment = String(input.payment_status || "").toLowerCase();
  return status === "completed" || payment === "paid";
}

/**
 * ARK dikembalikan sekali per pembayaran — bukan dijumlah per child checkout.
 * Prioritas: ledger wallet `payment` → `ark_coins_used` terbesar → total bila
 * metodenya ARK.
 */
export function resolveArkRefundAmount(input: {
  paymentMethod?: string | null;
  orders: Array<{ ark_coins_used?: number | string | null; total_amount?: number | string | null }>;
  walletPaymentAmount?: number | string | null;
}): number {
  const wallet = Number(input.walletPaymentAmount) || 0;
  if (wallet > 0) return wallet;

  const maxUsed = input.orders.reduce((max, order) => {
    const used = Number(order.ark_coins_used) || 0;
    return used > max ? used : max;
  }, 0);
  if (maxUsed > 0) return maxUsed;

  if (String(input.paymentMethod || "").toLowerCase() === "ark_coin") {
    return input.orders.reduce((sum, order) => sum + (Number(order.total_amount) || 0), 0);
  }
  return 0;
}

export function resolveCustomerStatsReversal(input: {
  customerId?: string | null;
  paidOrders: Array<{ total_amount?: number | string | null }>;
}): { customerId: string; amount: number; visitDelta: number } | null {
  if (!input.customerId || input.paidOrders.length === 0) return null;
  const amount = input.paidOrders.reduce(
    (sum, order) => sum + (Number(order.total_amount) || 0),
    0
  );
  if (amount <= 0) return null;
  return { customerId: input.customerId, amount, visitDelta: 1 };
}
