/**
 * "Pesanan saya" di self-order meja (owner 2026-10-01): pemesan yang memesan
 * lebih dari sekali dalam satu kunjungan melihat SEMUA pesanannya, bukan hanya
 * yang terakhir. Daftar id disimpan di browser pemesan (storage per meja).
 */

import { isOrderActive, orderProgressStep } from "./order-status";

export const MAX_TRACKED_ORDERS = 10;

/** Id terbaru di depan, tanpa duplikat, dibatasi MAX_TRACKED_ORDERS. */
export function rememberOrderId(ids: readonly string[], id: string) {
  return [id, ...ids.filter((existing) => existing !== id)].slice(0, MAX_TRACKED_ORDERS);
}

/** Id tersimpan; penyimpanan lama hanya punya `activeOrderId`. */
export function storedOrderIds(stored: { orderIds?: string[] | null; activeOrderId?: string | null }) {
  const ids = Array.isArray(stored.orderIds) ? stored.orderIds.filter((id) => typeof id === "string" && id) : [];
  return stored.activeOrderId && !ids.includes(stored.activeOrderId)
    ? rememberOrderId(ids, stored.activeOrderId)
    : ids.slice(0, MAX_TRACKED_ORDERS);
}

type OrderLike = { status: string; payment_status: string; total_amount: number };

/** Masih perlu diperhatikan: sedang diproses, atau belum lunas (dan tidak batal). */
export function orderNeedsAttention(order: OrderLike) {
  if (orderProgressStep(order.status) < 0) return false;
  return isOrderActive(order.status) || order.payment_status !== "paid";
}

/** Total yang masih harus dibayar dari semua pesanan (yang tidak batal). */
export function unpaidTotal(orders: readonly OrderLike[]) {
  return orders
    .filter((order) => orderProgressStep(order.status) >= 0 && order.payment_status !== "paid")
    .reduce((sum, order) => sum + (Number(order.total_amount) || 0), 0);
}
