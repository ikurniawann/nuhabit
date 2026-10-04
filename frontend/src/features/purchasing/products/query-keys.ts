export interface ProductListParams {
  search?: string;
  is_active?: boolean;
  warehouse_id?: string;
  hpp_review?: boolean;
  page?: number;
  limit?: number;
}

export const productsQueryKeys = {
  all: ["purchasing", "products"] as const,
  list: (params: ProductListParams) =>
    ["purchasing", "products", "list", params] as const,
  detail: (id: string) => ["purchasing", "products", "detail", id] as const,
  bom: (id: string) => ["purchasing", "products", "bom", id] as const,
  formData: ["purchasing", "products", "form-data"] as const,
  editData: (id: string) => ["purchasing", "products", "edit-data", id] as const,
  bomEditorData: (id: string) =>
    ["purchasing", "products", "bom-editor-data", id] as const,
  categories: () => ["purchasing", "products", "categories"] as const,
  warehouses: () => ["purchasing", "products", "warehouses"] as const,
};
