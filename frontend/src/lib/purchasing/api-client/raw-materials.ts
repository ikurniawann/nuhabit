import { BASE, fetchApi } from "@/lib/purchasing/api-client/http";
import type {
  RawMaterial,
  RawMaterialWithStock,
  RawMaterialFormData,
  RawMaterialListParams,
  PaginatedResponse,
} from "@/types/purchasing";

export async function listRawMaterials(
  params: RawMaterialListParams = {}
): Promise<PaginatedResponse<RawMaterialWithStock>> {
  const sp = new URLSearchParams();
  if (params.search) sp.set("search", params.search);
  if (params.kategori) sp.set("kategori", params.kategori);
  if (params.satuan_besar_id) sp.set("satuan_besar_id", params.satuan_besar_id);
  if (params.is_active !== undefined) sp.set("is_active", String(params.is_active));
  if (params.below_minimum) sp.set("below_minimum", "true");
  if (params.page) sp.set("page", String(params.page));
  if (params.limit) sp.set("limit", String(params.limit));
  if (params.sort_by) sp.set("sort_by", params.sort_by);
  if (params.sort_dir) sp.set("sort_dir", params.sort_dir);

  return fetchApi<PaginatedResponse<RawMaterialWithStock>>(
    `${BASE}/raw-materials?${sp.toString()}`
  );
}

export async function getRawMaterial(id: string): Promise<RawMaterialWithStock> {
  const response = await fetchApi<{ data: RawMaterialWithStock }>(
    `${BASE}/raw-materials/${id}`
  );
  return response.data;
}

export interface RawMaterialPurchaseCost {
  id: string;
  jumlah: number;
  unit_cost: number | null;
  total_cost: number | null;
  reference_type: string | null;
  reference_number: string | null;
  created_at: string;
}

export interface RawMaterialPriceHistory {
  material: {
    id: string;
    kode: string;
    nama: string;
    harga_beli: number;
    konversi_factor: number;
    satuan_besar_id: string | null;
    satuan_kecil_id: string | null;
  };
  purchase_costs: RawMaterialPurchaseCost[];
  summary: {
    months: number;
    purchase_count: number;
    last_cost: number | null;
    min_cost: number | null;
    max_cost: number | null;
    avg_cost: number | null;
  };
}

export async function getRawMaterialPriceHistory(
  id: string,
  params: { months?: number } = {}
): Promise<RawMaterialPriceHistory> {
  const sp = new URLSearchParams();
  if (params.months) sp.set("months", String(params.months));

  const query = sp.toString();
  const response = await fetchApi<{ data: RawMaterialPriceHistory }>(
    `${BASE}/raw-materials/${id}/price-history${query ? `?${query}` : ""}`
  );
  return response.data;
}

export interface RawMaterialPurchasePrice {
  raw_material_id: string;
  satuan_id: string | null;
  base_unit_cost: number;
  unit_price: number;
  source: "supplier_grn" | "any_grn" | "master" | null;
  reference_number: string | null;
  purchased_at: string | null;
}

/**
 * Suggested buying price for a material, derived from the last GRN cost instead
 * of a maintained price list. Falls back to the master purchase price.
 */
export async function getRawMaterialPurchasePrice(
  id: string,
  params: { supplierId?: string | null; satuanId?: string | null; months?: number } = {}
): Promise<RawMaterialPurchasePrice | null> {
  const sp = new URLSearchParams();
  if (params.supplierId) sp.set("supplier_id", params.supplierId);
  if (params.satuanId) sp.set("satuan_id", params.satuanId);
  if (params.months) sp.set("months", String(params.months));

  const query = sp.toString();
  const response = await fetchApi<{ data: RawMaterialPurchasePrice | null }>(
    `${BASE}/raw-materials/${id}/purchase-price${query ? `?${query}` : ""}`
  );
  return response.data ?? null;
}

export async function createRawMaterial(
  payload: RawMaterialFormData
): Promise<RawMaterial> {
  const response = await fetchApi<{ data: RawMaterial }>(
    `${BASE}/raw-materials`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    }
  );
  return response.data;
}

export async function updateRawMaterial(
  id: string,
  payload: Partial<RawMaterialFormData>
): Promise<RawMaterial> {
  const response = await fetchApi<{ data: RawMaterial }>(
    `${BASE}/raw-materials/${id}`,
    {
      method: "PUT",
      body: JSON.stringify(payload),
    }
  );
  return response.data;
}

export async function updateRawMaterialStatus(
  id: string,
  isActive: boolean
): Promise<RawMaterial> {
  const response = await fetchApi<{ data: RawMaterial }>(
    `${BASE}/raw-materials/${id}`,
    {
      method: "PUT",
      body: JSON.stringify({ is_active: isActive }),
    }
  );
  return response.data;
}

export async function deleteRawMaterial(id: string): Promise<void> {
  await fetchApi(`${BASE}/raw-materials/${id}`, { method: "DELETE" });
}
