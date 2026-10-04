// EPIC-026 C2 — Klien API inventory barang operasional.
import type {
  SupplyStockRow,
  SupplyStockDetail,
  SupplyStockListParams,
  SupplyInventoryFormData,
  SupplyUsageListRow,
  CreateSupplyUsagePayload,
  SupplyAdjustmentPayload,
} from "./types";

async function parseJson<T>(res: Response, fallback: string): Promise<T> {
  const json = await res.json().catch(() => null);
  if (!res.ok || json?.success === false) {
    throw new Error(json?.error || json?.message || fallback);
  }
  return (json?.data ?? json) as T;
}

export async function listSupplyStock(
  params: SupplyStockListParams = {}
): Promise<SupplyStockRow[]> {
  const sp = new URLSearchParams();
  if (params.search) sp.set("search", params.search);
  if (params.warehouse_id) sp.set("warehouse_id", params.warehouse_id);
  if (params.low_stock) sp.set("low_stock", "1");
  const res = await fetch(`/api/purchasing/inventory/supply?${sp.toString()}`);
  return parseJson<SupplyStockRow[]>(res, "Gagal memuat stok barang operasional");
}

export async function getSupplyStockDetail(id: string): Promise<SupplyStockDetail> {
  const res = await fetch(`/api/purchasing/inventory/supply/${id}`);
  return parseJson<SupplyStockDetail>(res, "Gagal memuat detail stok");
}

export async function getSupplyInventoryFormData(): Promise<SupplyInventoryFormData> {
  const res = await fetch("/api/purchasing/inventory/supply/form-data");
  return parseJson<SupplyInventoryFormData>(res, "Gagal memuat data form");
}

export async function listSupplyUsages(): Promise<SupplyUsageListRow[]> {
  const res = await fetch("/api/purchasing/inventory/supply-usage");
  return parseJson<SupplyUsageListRow[]>(res, "Gagal memuat pemakaian barang");
}

export async function createSupplyUsage(
  payload: CreateSupplyUsagePayload
): Promise<{ id: string; nomor: string }> {
  const res = await fetch("/api/purchasing/inventory/supply-usage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseJson<{ id: string; nomor: string }>(res, "Gagal menyimpan pemakaian");
}

export async function createSupplyAdjustment(
  payload: SupplyAdjustmentPayload
): Promise<{ qtyBefore: number; qtyAfter: number; qtyDiff: number }> {
  const res = await fetch("/api/purchasing/inventory/supply-adjustment", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseJson(res, "Gagal menyesuaikan stok");
}
