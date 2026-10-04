import type { ProductPRListParams } from "./types";

export const productPrQueryKeys = {
  all: ["purchasing", "product-pr"] as const,
  list: (params: ProductPRListParams) => ["purchasing", "product-pr", "list", params] as const,
  formData: () => ["purchasing", "product-pr", "form-data"] as const,
  detail: (id: string) => ["purchasing", "product-pr", "detail", id] as const,
};
