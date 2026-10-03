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
