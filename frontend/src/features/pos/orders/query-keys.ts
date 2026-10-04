import type { OrderListParams } from "./types";

export const ordersQueryKeys = {
  all: ["pos", "orders"] as const,
  list: (params: OrderListParams) => ["pos", "orders", "list", params] as const,
  detail: (orderId: string) => ["pos", "orders", "detail", orderId] as const,
};
