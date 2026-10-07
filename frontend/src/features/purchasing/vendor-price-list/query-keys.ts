export const vendorPriceListQueryKeys = {
  all: ["purchasing", "vendor-price-list"] as const,
  list: (params: Record<string, unknown>) =>
    ["purchasing", "vendor-price-list", "list", params] as const,
  detail: (id: string) => ["purchasing", "vendor-price-list", "detail", id] as const,
  formData: () => ["purchasing", "vendor-price-list", "form-data"] as const,
};
