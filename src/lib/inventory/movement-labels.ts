/** Label mutasi stok untuk UI dan ekspor CSV (aman dipakai di client). */

export const MOVEMENT_TIPE_LABELS: Record<string, string> = {
  in: "Masuk",
  out: "Keluar",
  adjustment: "Penyesuaian",
  transfer: "Transfer",
  return: "Retur",
};

export const MOVEMENT_REFERENCE_LABELS: Record<string, string> = {
  grn: "Penerimaan (GRN)",
  grn_delete: "Pembatalan GRN",
  adjustment: "Penyesuaian manual",
  stock_opname: "Stok opname",
  stock_transfer: "Transfer stok",
  scrap: "Scrap / write-off",
  production: "Pemakaian produksi",
  production_wip: "Hasil produksi",
  sales_realization: "Realisasi penjualan",
  purchase_return: "Retur pembelian",
  import: "Impor / saldo awal",
};

export function movementReferenceLabel(type: string | null | undefined): string {
  if (!type) return "-";
  return MOVEMENT_REFERENCE_LABELS[type] ?? type;
}

export type StockStatus = "normal" | "low_stock" | "out_of_stock" | "overstock";
export type MovementType = "in" | "out" | "adjustment" | "transfer" | "return";

export const STOCK_STATUS_LABELS: Record<StockStatus, string> = {
  normal: "Normal",
  low_stock: "Stok Rendah",
  out_of_stock: "Habis",
  overstock: "Berlebih",
};

export const STOCK_STATUS_COLORS: Record<StockStatus, string> = {
  normal: "bg-green-100 text-green-700 border-green-200",
  low_stock: "bg-yellow-100 text-yellow-700 border-yellow-200",
  out_of_stock: "bg-red-100 text-red-700 border-red-200",
  overstock: "bg-blue-100 text-blue-700 border-blue-200",
};

export const MOVEMENT_TYPE_COLORS: Record<MovementType, string> = {
  in: "bg-green-100 text-green-700",
  out: "bg-red-100 text-red-700",
  adjustment: "bg-yellow-100 text-yellow-700",
  transfer: "bg-blue-100 text-blue-700",
  return: "bg-purple-100 text-purple-700",
};
