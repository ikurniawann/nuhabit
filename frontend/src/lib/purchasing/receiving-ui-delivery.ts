/** Halaman pengiriman PO (bahan baku dan produk): status, ringkasan item, validasi form. */

export type DeliveryStatus = "pending" | "shipped" | "in_transit" | "delivered" | "cancelled";

export const DELIVERY_STATUS_LABELS: Record<DeliveryStatus, string> = {
  pending: "Menunggu Penerimaan",
  shipped: "Dikirim",
  in_transit: "Dalam Pengiriman",
  delivered: "Tiba",
  cancelled: "Dibatalkan",
};

export const DELIVERY_STATUS_STYLES: Record<DeliveryStatus, string> = {
  pending: "bg-amber-50 text-amber-700 border-amber-200",
  shipped: "bg-blue-50 text-blue-700 border-blue-200",
  in_transit: "bg-indigo-50 text-indigo-700 border-indigo-200",
  delivered: "bg-emerald-50 text-emerald-700 border-emerald-200",
  cancelled: "bg-gray-100 text-gray-600 border-gray-200",
};

export const DELIVERY_STATUS_OPTIONS: { value: DeliveryStatus | "all"; label: string }[] = [
  { value: "all", label: "Semua Status" },
  ...(Object.keys(DELIVERY_STATUS_LABELS) as DeliveryStatus[]).map((value) => ({
    value,
    label: DELIVERY_STATUS_LABELS[value],
  })),
];

type QtyLike = number | string | null | undefined;
export type DeliveryPoItem = { qty_ordered?: QtyLike; qty_received?: QtyLike; subtotal?: QtyLike };

const num = (value: QtyLike) => {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
};

export function deliveryItemRemaining(item: DeliveryPoItem): number {
  return Math.max(0, num(item.qty_ordered) - num(item.qty_received));
}

/**
 * Ringkasan item PO untuk form pengiriman. Kirim ulang = sebagian sudah
 * diterima dan masih ada sisa.
 */
export function summarizeDeliveryItems(items: DeliveryPoItem[]) {
  const totalReceived = items.reduce((sum, item) => sum + num(item.qty_received), 0);
  const totalRemaining = items.reduce((sum, item) => sum + deliveryItemRemaining(item), 0);
  return {
    subtotal: items.reduce((sum, item) => sum + num(item.subtotal), 0),
    totalReceived,
    totalRemaining,
    itemsWithRemaining: items.filter((item) => deliveryItemRemaining(item) > 0).length,
    isReship: totalReceived > 0 && totalRemaining > 0,
  };
}

export type DeliveryFormFields = {
  no_surat_jalan: string;
  kurir: string;
  no_resi: string;
  tanggal_kirim: string;
  tanggal_estimasi_tiba: string;
  catatan: string;
};

/** Pesan galat pertama, atau null bila form pengiriman lengkap. */
export function validateDeliveryForm(poId: string, form: DeliveryFormFields): string | null {
  if (!poId || !form.no_surat_jalan.trim()) return "Purchase order dan nomor surat jalan wajib diisi.";
  if (!form.tanggal_kirim) return "Tanggal kirim wajib diisi.";
  if (!form.tanggal_estimasi_tiba) return "Estimasi tanggal tiba wajib diisi.";
  return null;
}
