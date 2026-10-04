/**
 * Pesanan self-order (QR meja) yang baru masuk & belum diterima kasir —
 * dipakai gelembung notifikasi di POS → Orders. Murni (klien & server).
 */
import { paymentFlowFrom } from "./order-status";

export const TABLE_ORDER_PREFIX = "Self-service table order";

type IncomingOrderLike = {
  status?: string | null;
  special_requests?: string | null;
  ordered_at?: string | null;
  created_at?: string | null;
};

export function isSelfOrder(order: Pick<IncomingOrderLike, "special_requests">): boolean {
  return String(order.special_requests || "").startsWith(TABLE_ORDER_PREFIX);
}

/** "Self-service table order WIT-OFFICE-BDG; payment=cashier" → "WIT-OFFICE-BDG". */
export function selfOrderTableCode(order: Pick<IncomingOrderLike, "special_requests">): string | null {
  const match = new RegExp(`^${TABLE_ORDER_PREFIX}\\s+([^;]+)`).exec(String(order.special_requests || ""));
  return match ? match[1].trim() || null : null;
}

export function selfOrderPaymentFlow(order: Pick<IncomingOrderLike, "special_requests">): string {
  return paymentFlowFrom(order.special_requests ?? null, null);
}

/** Batas "baru": lebih lama dari ini dilipat di layar kasir (sisa uji / terlupa). */
export const INCOMING_RECENT_HOURS = 12;

/** Pisahkan pesanan baru (≤ N jam) dari yang lama, pertahankan urutan. */
export function splitByRecency<T extends IncomingOrderLike>(orders: T[], now = Date.now(), hours = INCOMING_RECENT_HOURS) {
  const cutoff = now - hours * 3_600_000;
  const recent: T[] = [];
  const older: T[] = [];
  for (const order of orders) {
    const at = Date.parse(String(order.ordered_at || order.created_at || ""));
    (Number.isFinite(at) && at < cutoff ? older : recent).push(order);
  }
  return { recent, older };
}

/** "baru saja" · "12 mnt lalu" · "3 jam lalu" · "2 hari lalu". */
export function timeAgoText(iso: string | null | undefined, now = Date.now()): string {
  const at = Date.parse(String(iso || ""));
  if (!Number.isFinite(at)) return "";
  const minutes = Math.max(0, Math.floor((now - at) / 60_000));
  if (minutes < 1) return "baru saja";
  if (minutes < 60) return `${minutes} mnt lalu`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} jam lalu`;
  return `${Math.floor(hours / 24)} hari lalu`;
}

/** Self-order berstatus pending (belum ditekan "Dibuat"), terlama di atas. */
export function pickIncomingSelfOrders<T extends IncomingOrderLike>(orders: T[]): T[] {
  return orders
    .filter((order) => order.status === "pending" && isSelfOrder(order))
    .sort((a, b) => String(a.ordered_at || a.created_at || "").localeCompare(String(b.ordered_at || b.created_at || "")));
}
