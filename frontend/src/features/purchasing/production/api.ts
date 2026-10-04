import type { AdditionalCost, AdditionalCostPayload, AdditionalCostReferenceType } from "@/lib/purchasing/cogs-additional-cost-ui";
import type { PurchasingModuleType } from "@/lib/purchasing/module-scope";
import type { RawMaterialWithStock } from "@/types/purchasing";
import type {
  CogsData,
  CreateProductionOrderPayload,
  ProductionDashboardData,
  ProductionDetail,
  RawMaterialBomRow,
  RecipeItem,
} from "./types";

type ApiBody = { data?: unknown; summary?: unknown; message?: string; error?: string };

/** Ambil JSON; respons gagal dilempar sebagai Error berisi `error` (format baru) atau `message`. */
async function requestJson(url: string, fallback: string, init?: RequestInit): Promise<ApiBody> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const json = ((await response.json().catch(() => null)) ?? {}) as ApiBody;
  if (!response.ok) throw new Error(json.error || json.message || fallback);
  return json;
}

function sendJson(url: string, method: string, payload: unknown, fallback: string) {
  return requestJson(url, fallback, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

/** Untuk data pelengkap: gagal dibaca sebagai kosong, sama seperti sebelumnya. */
function optionalJson(url: string): Promise<ApiBody> {
  return requestJson(url, "").catch(() => ({}));
}

function recipesUrl(moduleType: PurchasingModuleType) {
  return moduleType === "product"
    ? "/api/purchasing/production/product-recipes"
    : "/api/purchasing/production/raw-material-recipes";
}

export async function getProductionDashboard(
  moduleType: PurchasingModuleType = "raw_material"
): Promise<ProductionDashboardData> {
  const context = moduleType === "product" ? "product" : "raw_material";
  const [orders, items, wip] = await Promise.all([
    optionalJson(`/api/purchasing/production/orders?production_context=${context}`),
    optionalJson(recipesUrl(moduleType)),
    optionalJson("/api/purchasing/production/wip"),
  ]);
  return {
    orders: (orders.data as ProductionDashboardData["orders"]) || [],
    products: (items.data as ProductionDashboardData["products"]) || [],
    wipInventory: (wip.data as ProductionDashboardData["wipInventory"]) || [],
    wipSummary: (wip.summary as ProductionDashboardData["wipSummary"]) || null,
  };
}

export async function getProductionCogs(
  moduleType: PurchasingModuleType,
  id: string
): Promise<CogsData | null> {
  const url =
    moduleType === "product"
      ? `/api/purchasing/cogs/product/${id}`
      : `/api/purchasing/cogs/raw-material/${id}`;
  const json = await requestJson(url, "Gagal memuat resep (BOM)");
  return (json.data as CogsData) || null;
}

export async function listRecipeItems(moduleType: PurchasingModuleType): Promise<RecipeItem[]> {
  const json = await requestJson(recipesUrl(moduleType), "Gagal memuat daftar resep");
  return (json.data as RecipeItem[]) || [];
}

/** Buat order produksi; mengembalikan pesan sukses dari API. */
export async function createProductionOrder(payload: CreateProductionOrderPayload): Promise<string | undefined> {
  const json = await sendJson("/api/purchasing/production/orders", "POST", payload, "Gagal membuat order produksi");
  return json.message;
}

export async function getProductionOrder(id: string): Promise<ProductionDetail> {
  const json = await requestJson(`/api/purchasing/production/orders/${id}`, "Gagal memuat detail order produksi");
  return json.data as ProductionDetail;
}

/** Jalankan aksi order (release/start/complete/...); mengembalikan pesan sukses dari API. */
export async function updateProductionOrder(
  id: string,
  payload: Record<string, unknown>
): Promise<string | undefined> {
  const json = await sendJson(
    `/api/purchasing/production/orders/${id}`,
    "PATCH",
    payload,
    "Gagal memperbarui order produksi"
  );
  return json.message;
}

export async function getRawMaterialBomEditorData(materialId: string) {
  const [material, bom, materials] = await Promise.all([
    requestJson(`/api/purchasing/raw-materials/${materialId}`, "Gagal memuat bahan baku"),
    optionalJson(`/api/purchasing/raw-materials/${materialId}/bom`),
    optionalJson("/api/purchasing/raw-materials?limit=200&is_active=true"),
  ]);
  return {
    material: material.data as RawMaterialWithStock,
    bom: (bom.data as RawMaterialBomRow[]) || [],
    materials: ((materials.data as RawMaterialWithStock[]) || []).filter((item) => item.id !== materialId),
  };
}

export async function createRawMaterialBomItem(
  materialId: string,
  payload: { component_raw_material_id: string; qty_required: number; waste_factor: number }
): Promise<RawMaterialBomRow> {
  const json = await sendJson(
    `/api/purchasing/raw-materials/${materialId}/bom`,
    "POST",
    payload,
    "Gagal menambah komponen"
  );
  return json.data as RawMaterialBomRow;
}

export async function updateRawMaterialBomItem(
  id: string,
  payload: { qty_required: number; waste_factor: number }
): Promise<void> {
  await sendJson(`/api/purchasing/raw-material-bom/${id}`, "PUT", payload, "Gagal memperbarui komponen");
}

export async function deleteRawMaterialBomItem(id: string): Promise<void> {
  await requestJson(`/api/purchasing/raw-material-bom/${id}`, "Gagal menghapus komponen", { method: "DELETE" });
}

const ADDITIONAL_COST_URL = "/api/purchasing/cogs/additional-cost";

/** Biaya tambahan pembelian aktif, opsional hanya satu jenis dokumen (PO/GRN). */
export async function listAdditionalCosts(referenceType?: AdditionalCostReferenceType): Promise<AdditionalCost[]> {
  const query = referenceType ? `?reference_type=${referenceType}` : "";
  const json = await requestJson(`${ADDITIONAL_COST_URL}${query}`, "Gagal memuat biaya tambahan");
  return (json.data as AdditionalCost[]) || [];
}

export async function createAdditionalCost(payload: AdditionalCostPayload): Promise<string | undefined> {
  const json = await sendJson(ADDITIONAL_COST_URL, "POST", payload, "Gagal menambah biaya tambahan");
  return json.message;
}

export async function deleteAdditionalCost(id: string): Promise<string | undefined> {
  const json = await requestJson(`${ADDITIONAL_COST_URL}/${id}`, "Gagal menghapus biaya tambahan", { method: "DELETE" });
  return json.message;
}
