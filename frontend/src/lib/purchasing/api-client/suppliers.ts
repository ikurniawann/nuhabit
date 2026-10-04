import { BASE, fetchApi } from "@/lib/purchasing/api-client/http";
import type {
  Supplier,
} from "@/types/purchasing";

export async function listSuppliers(
  params: { search?: string; is_active?: boolean } = {}
): Promise<Supplier[]> {
  const sp = new URLSearchParams();
  if (params.search) sp.set("search", params.search);
  if (params.is_active !== undefined) sp.set("is_active", String(params.is_active));

  const response = await fetchApi<{ data: Supplier[] }>(
    `${BASE}/suppliers?${sp.toString()}`
  );
  return response.data;
}
