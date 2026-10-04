import type { ProductPOListParams } from "./types";

export const productPoQueryKeys = {
  all: ["purchasing", "product-po"] as const,
  list: (params: ProductPOListParams) => ["purchasing", "product-po", "list", params] as const,
  detail: (id: string) => ["purchasing", "product-po", "detail", id] as const,
  formData: () => ["purchasing", "product-po", "form-data"] as const,
  approvedPRs: () => ["purchasing", "product-po", "approved-prs"] as const,
};
