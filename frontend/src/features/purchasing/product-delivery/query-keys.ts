import type { ProductDeliveryListParams } from "./types";

export const productDeliveryQueryKeys = {
  all: ["purchasing", "product-delivery"] as const,
  list: (params: ProductDeliveryListParams) =>
    ["purchasing", "product-delivery", "list", params] as const,
  detail: (id: string) => ["purchasing", "product-delivery", "detail", id] as const,
  poOptions: (includeCancelled: boolean) =>
    ["purchasing", "product-delivery", "po-options", includeCancelled] as const,
  poItems: (poId: string) => ["purchasing", "product-delivery", "po-items", poId] as const,
};
