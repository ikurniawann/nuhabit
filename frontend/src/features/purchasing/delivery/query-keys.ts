import type { DeliveryListParams } from "./types";

export const deliveryQueryKeys = {
  all: ["purchasing", "delivery"] as const,
  list: (params: DeliveryListParams) =>
    ["purchasing", "delivery", "list", params] as const,
  detail: (id: string) => ["purchasing", "delivery", "detail", id] as const,
  poOptions: (includeCancelled: boolean) =>
    ["purchasing", "delivery", "po-options", includeCancelled] as const,
  poItems: (poId: string) =>
    ["purchasing", "delivery", "po-items", poId] as const,
};
