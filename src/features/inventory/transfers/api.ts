import type {
  CreateStockTransferInput,
  StockTransferListParams,
  StockTransferRecord,
  WarehouseOption,
} from "./types";

export type StockTransferListResult = {
  data: StockTransferRecord[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    total_pages: number;
  };
};

async function parseJson<T>(res: Response): Promise<T> {
  const json = await res.json();
  if (!res.ok) {
    throw new Error(json.error || json.message || "Request failed");
  }
  return json;
}

export async function listStockTransfers(
  params: StockTransferListParams = {},
): Promise<StockTransferListResult> {
  const sp = new URLSearchParams();
  if (params.page) sp.set("page", String(params.page));
  if (params.limit) sp.set("limit", String(params.limit));

  const res = await fetch(
    `/api/purchasing/inventory/transfer?${sp.toString()}`,
  );
  const json = await parseJson<{
    success: boolean;
    data: StockTransferRecord[];
    pagination: StockTransferListResult["pagination"];
  }>(res);

  return {
    data: json.data || [],
    pagination: json.pagination,
  };
}

export async function createStockTransfer(input: CreateStockTransferInput) {
  const res = await fetch("/api/purchasing/inventory/transfer", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return parseJson<{ success: boolean; message?: string; data: unknown }>(res);
}

export async function listTransferWarehouses(): Promise<WarehouseOption[]> {
  const res = await fetch("/api/purchasing/warehouses");
  const json = await res.json();
  if (!res.ok) {
    throw new Error(json.error || json.message || "Failed to load stalls");
  }
  return Array.isArray(json.data) ? json.data : [];
}

export type SourceStockLine = {
  raw_material_id: string;
  material_kode: string;
  material_nama: string;
  satuan: string | null;
  satuan_besar_nama: string | null;
  qty_system: number;
};

export async function listSourceStockLines(
  warehouseId: string,
): Promise<SourceStockLine[]> {
  const res = await fetch(
    `/api/purchasing/inventory/transfer/preview?warehouse_id=${encodeURIComponent(warehouseId)}`,
  );
  const json = await res.json();
  if (!res.ok) {
    throw new Error(json.error || json.message || "Failed to load stock");
  }
  return (json.data || []) as SourceStockLine[];
}
