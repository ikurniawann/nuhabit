import { getOrders, type Order } from "@/lib/pos-api";
import { pickIncomingSelfOrders } from "@/lib/table-order/incoming";

export const selfOrdersQueryKey = ["pos", "incoming-self-orders"] as const;

/** Self-order baru (pending) — terlama di atas. */
export async function fetchIncomingSelfOrders(): Promise<Order[]> {
  const res = await getOrders({ status: "pending", limit: 100 });
  if (!res.success) throw new Error("Gagal memuat pesanan self-order");
  return pickIncomingSelfOrders(res.data ?? []);
}

/** Kasir menekan "Dibuat": pending → confirmed, status bayar tetap. */
export async function acceptSelfOrder(orderId: string) {
  const res = await fetch(`/api/pos/orders/${encodeURIComponent(orderId)}/accept`, {
    method: "POST",
    credentials: "include",
  });
  const json = (await res.json().catch(() => ({}))) as { success?: boolean; error?: string };
  if (!res.ok || json.success === false) throw new Error(json.error || `Gagal (${res.status})`);
  return json;
}
