import { BASE, fetchApi } from "@/lib/purchasing/api-client/http";
import type {
  Unit,
  UnitFormData,
} from "@/types/purchasing";

export interface UnitListParams {
  search?: string;
  page?: number;
  limit?: number;
}

export async function listUnits(
  params?: UnitListParams
): Promise<{ data: Unit[]; pagination: { page: number; limit: number; total: number; total_pages: number } }> {
  const sp = new URLSearchParams();
  if (params?.search) sp.set("search", params.search);
  if (params?.page) sp.set("page", String(params.page));
  if (params?.limit) sp.set("limit", String(params.limit));

  const response = await fetchApi<{
    data: Unit[];
    pagination: { page: number; limit: number; total: number; total_pages: number };
  }>(`${BASE}/units?${sp.toString()}`);
  return response;
}

export async function createUnit(
  payload: UnitFormData
): Promise<Unit> {
  const response = await fetchApi<{ data: Unit }>(`${BASE}/units`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return response.data;
}

export async function updateUnit(
  id: string,
  payload: Partial<UnitFormData>
): Promise<Unit> {
  const response = await fetchApi<{ data: Unit }>(
    `${BASE}/units/${id}`,
    {
      method: "PUT",
      body: JSON.stringify(payload),
    }
  );
  return response.data;
}

export async function updateUnitStatus(
  id: string,
  isActive: boolean
): Promise<Unit> {
  const response = await fetchApi<{ data: Unit }>(
    `${BASE}/units/${id}`,
    {
      method: "PUT",
      body: JSON.stringify({ is_active: isActive }),
    }
  );
  return response.data;
}

export async function deleteUnit(id: string): Promise<void> {
  await fetchApi(`${BASE}/units/${id}`, { method: "DELETE" });
}
