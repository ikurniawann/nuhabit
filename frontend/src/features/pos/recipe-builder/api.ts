import type {
  BomApiRow,
  BomRow,
  RecipeCatalogBundle,
  RecipeProduct,
  RecipeRawMaterial,
  SaveBomItemPayload,
} from "./types";

export type * from "./types";

function toNumber(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });
  const json = await response.json();
  if (!response.ok || json.success === false) {
    throw new Error(json.message || json.error || "Request gagal");
  }
  return json as T;
}

export function mapBomRows(items: BomApiRow[]): BomRow[] {
  return items.map((item) => ({
    id: item.id,
    raw_material_id: item.raw_material_id,
    name: item.raw_material?.nama || item.raw_material?.name || "Bahan",
    unit: item.satuan?.nama || item.raw_material?.satuan_besar?.nama || item.raw_material?.satuan || "-",
    quantity: toNumber(item.qty_required),
    wasteFactor: toNumber(item.waste_factor),
    costPerUnit: toNumber(item.cost_per_unit || item.raw_material?.avg_cost),
  }));
}

export async function getRecipeCatalog(): Promise<RecipeCatalogBundle> {
  const [productJson, materialJson] = await Promise.all([
    fetchJson<{ success?: boolean; data: RecipeProduct[] }>(
      "/api/purchasing/products?is_active=true&limit=200"
    ),
    fetchJson<{ data: RecipeRawMaterial[] }>("/api/purchasing/raw-materials?is_active=true&limit=300"),
  ]);
  return {
    products: productJson.data ?? [],
    materials: materialJson.data ?? [],
  };
}

export async function getProductBom(productId: string): Promise<BomRow[]> {
  const json = await fetchJson<{ success: boolean; data: BomApiRow[] }>(
    `/api/purchasing/products/${productId}/bom`,
    { cache: "no-store" }
  );
  return mapBomRows(json.data ?? []);
}

export async function deleteBomItem(id: string): Promise<void> {
  await fetchJson(`/api/purchasing/bom/${id}`, { method: "DELETE" });
}

export async function createBomItem(productId: string, payload: SaveBomItemPayload): Promise<void> {
  await fetchJson(`/api/purchasing/products/${productId}/bom`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateBomItem(
  id: string,
  payload: Pick<SaveBomItemPayload, "qty_required" | "waste_factor">
): Promise<void> {
  await fetchJson(`/api/purchasing/bom/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export async function saveRecipeItems(productId: string, items: BomRow[]): Promise<void> {
  for (const item of items) {
    const payload: SaveBomItemPayload = {
      raw_material_id: item.raw_material_id,
      qty_required: Math.max(0.0001, toNumber(item.quantity)),
      waste_factor: Math.min(1, Math.max(0, toNumber(item.wasteFactor))),
    };
    if (item.id) {
      await updateBomItem(item.id, {
        qty_required: payload.qty_required,
        waste_factor: payload.waste_factor,
      });
    } else {
      await createBomItem(productId, payload);
    }
  }
}
