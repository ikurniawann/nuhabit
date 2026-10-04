import { rawMaterialStockSource } from "@/lib/api/stall-scope";
import type { DbClient } from "@/lib/pg/types";
import { toQty } from "@/lib/purchasing/utils";

type Numeric = number | string | null | undefined;

export interface ValuationStockRow {
  kategori: string;
  qty_onhand?: Numeric;
  avg_cost?: Numeric;
  unit_cost?: Numeric;
  min_stock?: Numeric;
  stok_minimum?: Numeric;
  max_stock?: Numeric;
  stok_maximum?: Numeric;
  satuan?: string | null;
  satuan_besar_nama?: string | null;
  lokasi_rak?: string | null;
  [column: string]: unknown;
}

const KATEGORI_LABELS: Record<string, string> = {
  BAHAN_PANGAN: "Bahan Pangan",
  BAHAN_NON_PANGAN: "Bahan Non-Pangan",
  KEMASAN: "Kemasan",
  BAHAN_BAKAR: "Bahan Bakar",
  LAINNYA: "Lainnya",
};

/** Nilai persediaan = qty x avg cost (fallback unit_cost), direkap per kategori. */
export function buildInventoryValuation(rows: ValuationStockRow[]) {
  const data = rows.map((item) => {
    const qty = toQty(item.qty_onhand);
    const avgCost = toQty(item.avg_cost ?? item.unit_cost);
    return {
      ...item,
      qty_onhand: qty,
      min_stock: toQty(item.min_stock ?? item.stok_minimum),
      max_stock: item.max_stock ?? item.stok_maximum ?? null,
      avg_cost: avgCost,
      unit_cost: avgCost,
      total_value: qty * avgCost,
      satuan: item.satuan || item.satuan_besar_nama || "",
      lokasi_rak: item.lokasi_rak || "-",
    };
  });

  let totalValue = 0;
  const byCategory: Record<string, { kategori: string; total_value: number; item_count: number }> = {};
  for (const item of data) {
    totalValue += item.total_value;
    const bucket = (byCategory[item.kategori] ??= { kategori: item.kategori, total_value: 0, item_count: 0 });
    bucket.total_value += item.total_value;
    bucket.item_count += 1;
  }

  return {
    data,
    summary: {
      total_value: totalValue,
      total_items: data.length,
      by_category: Object.values(byCategory).map((cat) => ({
        ...cat,
        kategori: KATEGORI_LABELS[cat.kategori] || cat.kategori,
      })),
    },
  };
}

/** Bahan aktif dari view stok stall aktif (sidebar), urut kategori. */
export async function loadValuationStock(db: DbClient) {
  const { view, warehouseId } = await rawMaterialStockSource();
  let query = db.from(view).select("*").eq("is_active", true);
  if (warehouseId) query = query.eq("warehouse_id", warehouseId);

  const { data, error } = await query.order("kategori", { ascending: true });
  if (error) throw error;
  return (data || []) as ValuationStockRow[];
}
