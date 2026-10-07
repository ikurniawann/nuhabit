import { getOrders } from "@/lib/pos-api";
import type { Order } from "@/lib/pos-api";
import type { OrderListParams } from "./types";

export type * from "./types";

export async function listOrders(params: OrderListParams = {}): Promise<Order[]> {
  const res = await getOrders(params);
  if (!res.success) {
    throw new Error("Gagal memuat orders");
  }
  return res.data ?? [];
}
