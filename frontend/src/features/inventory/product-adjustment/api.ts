import { fetchJson } from "../shared/inventory-lookups";

export type AdjustLine = {
  key: string;
  product_id: string;
  product_kode: string;
  product_nama: string;
  satuan: string | null;
  qty_system: number;
  qty_actual_input: string;
};

type FinishedGoodsRow = {
  id?: string;
  product_id?: string | null;
  product_kode?: string | null;
  product_nama?: string | null;
  satuan_nama?: string | null;
  qty_available?: number | string | null;
};

/** Produk jadi di satu stall sebagai baris penyesuaian (stok aktual masih kosong). */
export async function fetchStallAdjustLines(
  warehouseId: string,
): Promise<AdjustLine[]> {
  const json = await fetchJson<{
    data?: FinishedGoodsRow[] | { data?: FinishedGoodsRow[] };
  }>(
    `/api/inventory/finished-goods?limit=500&warehouse_id=${encodeURIComponent(warehouseId)}`,
  );
  const rows = Array.isArray(json.data) ? json.data : (json.data?.data ?? []);
  return rows.map((row) => {
    const id = String(row.product_id || row.id);
    return {
      key: id,
      product_id: id,
      product_kode: String(row.product_kode || ""),
      product_nama: String(row.product_nama || ""),
      satuan: row.satuan_nama || null,
      qty_system: Number(row.qty_available) || 0,
      qty_actual_input: "",
    };
  });
}

export const adjustProductStock = (body: {
  product_id: string;
  qty_actual: number;
  notes: string;
}) =>
  fetchJson("/api/inventory/finished-goods/adjustment", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
