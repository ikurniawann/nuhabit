import { BASE, fetchApi } from "@/lib/purchasing/api-client/http";
import type {
  Product,
  ProductWithCOGS,
  ProductFormData,
  BOMItem,
  BOMItemFormData,
  PaginatedResponse,
} from "@/types/purchasing";

export async function listProducts(
  params: {
    search?: string;
    is_active?: boolean;
    warehouse_id?: string;
    hpp_review?: boolean;
    page?: number;
    limit?: number;
  } = {}
): Promise<PaginatedResponse<ProductWithCOGS>> {
  const sp = new URLSearchParams();
  if (params.search) sp.set("search", params.search);
  if (params.is_active !== undefined) sp.set("is_active", String(params.is_active));
  if (params.warehouse_id) sp.set("warehouse_id", params.warehouse_id);
  if (params.hpp_review) sp.set("hpp_review", "true");
  if (params.page) sp.set("page", String(params.page));
  if (params.limit) sp.set("limit", String(params.limit));

  const response = await fetchApi<
    | PaginatedResponse<ProductWithCOGS>
    | {
        success?: boolean;
        data: ProductWithCOGS[];
        pagination: {
          page: number;
          limit: number;
          total: number;
          total_pages: number;
        };
      }
  >(
    `${BASE}/products?${sp.toString()}`
  );

  if ("pagination" in response) {
    return {
      data: response.data,
      total: response.pagination.total,
      page: response.pagination.page,
      limit: response.pagination.limit,
      total_pages: response.pagination.total_pages,
      pagination: response.pagination,
    };
  }

  return response;
}

export async function getProduct(id: string): Promise<ProductWithCOGS> {
  const response = await fetchApi<{ data: ProductWithCOGS }>(
    `${BASE}/products/${id}`
  );
  return response.data;
}

export async function createProduct(
  payload: ProductFormData
): Promise<Product> {
  const response = await fetchApi<{ data: Product }>(
    `${BASE}/products`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    }
  );
  return response.data;
}

export async function applyProductRecipeHpp(
  id: string
): Promise<{ data: ProductWithCOGS; message?: string }> {
  const response = await fetchApi<{ data: ProductWithCOGS; message?: string }>(
    `${BASE}/products/${id}/apply-recipe-hpp`,
    { method: "POST" }
  );
  return response;
}

export async function updateProduct(
  id: string,
  payload: Partial<ProductFormData>
): Promise<Product> {
  const response = await fetchApi<{ data: Product }>(
    `${BASE}/products/${id}`,
    {
      method: "PUT",
      body: JSON.stringify(payload),
    }
  );
  return response.data;
}

export async function updateProductStatus(
  id: string,
  isActive: boolean
): Promise<Product> {
  const response = await fetchApi<{ data: Product }>(
    `${BASE}/products/${id}`,
    {
      method: "PUT",
      body: JSON.stringify({ is_active: isActive }),
    }
  );
  return response.data;
}

export async function deleteProduct(id: string): Promise<void> {
  await fetchApi(`${BASE}/products/${id}`, { method: "DELETE" });
}

export async function listBOMItems(
  productId: string
): Promise<BOMItem[]> {
  const response = await fetchApi<{ data: BOMItem[] }>(
    `${BASE}/products/${productId}/bom`
  );
  return response.data;
}

export async function createBOMItem(
  productId: string,
  payload: BOMItemFormData
): Promise<BOMItem> {
  const body = {
    raw_material_id: payload.raw_material_id,
    qty_required: payload.qty_required ?? payload.qty_needed,
    waste_factor: payload.waste_factor ?? ((payload.waste_persen ?? 0) / 100),
    ...((payload.satuan_id ?? payload.unit_id)
      ? { satuan_id: payload.satuan_id ?? payload.unit_id }
      : {}),
  };

  const response = await fetchApi<{ data: BOMItem }>(
    `${BASE}/products/${productId}/bom`,
    {
      method: "POST",
      body: JSON.stringify(body),
    }
  );
  return response.data;
}

export async function updateBOMItem(
  id: string,
  payload: Partial<BOMItemFormData>
): Promise<BOMItem> {
  const body = {
    ...(payload.raw_material_id ? { raw_material_id: payload.raw_material_id } : {}),
    ...(payload.qty_required !== undefined || payload.qty_needed !== undefined
      ? { qty_required: payload.qty_required ?? payload.qty_needed }
      : {}),
    ...(payload.satuan_id !== undefined || payload.unit_id !== undefined
      ? { satuan_id: payload.satuan_id ?? payload.unit_id ?? null }
      : {}),
    ...(payload.waste_factor !== undefined || payload.waste_persen !== undefined
      ? { waste_factor: payload.waste_factor ?? ((payload.waste_persen ?? 0) / 100) }
      : {}),
  };

  const response = await fetchApi<{ data: BOMItem }>(
    `${BASE}/bom/${id}`,
    {
      method: "PUT",
      body: JSON.stringify(body),
    }
  );
  return response.data;
}

export async function deleteBOMItem(id: string): Promise<void> {
  await fetchApi(`${BASE}/bom/${id}`, { method: "DELETE" });
}
