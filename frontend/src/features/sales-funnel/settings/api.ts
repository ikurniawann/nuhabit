import { parseError } from "../api-error";

export interface RecipeRowResponse {
  raw_material_id: string;
  material_nama: string;
  material_kode: string | null;
  satuan_kecil: string | null;
  quantity_per_unit: string;
  unit_of_measure: string | null;
  waste_percentage: string;
}

export interface RawMaterialOption {
  id: string;
  kode: string | null;
  nama: string;
  satuan_kecil: string | null;
}

export interface RecipeItemPayload {
  raw_material_id: string;
  quantity_per_unit: number;
  waste_percentage: number;
}

export async function fetchRecipe(productId: string): Promise<RecipeRowResponse[]> {
  const res = await fetch(`/api/sales-funnel/recipes?product_id=${productId}`);
  if (!res.ok) await parseError(res, "Gagal memuat resep");
  const body = (await res.json()) as { data: RecipeRowResponse[] };
  return body.data;
}

export async function searchRawMaterials(q: string): Promise<RawMaterialOption[]> {
  const res = await fetch(`/api/sales-funnel/raw-materials?q=${encodeURIComponent(q)}`);
  if (!res.ok) await parseError(res, "Gagal mencari bahan baku");
  const body = (await res.json()) as { data: RawMaterialOption[] };
  return body.data;
}

export async function saveRecipe(productId: string, items: RecipeItemPayload[]): Promise<void> {
  const res = await fetch("/api/sales-funnel/recipes", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ product_id: productId, items }),
  });
  if (!res.ok) await parseError(res, "Gagal menyimpan resep");
}
