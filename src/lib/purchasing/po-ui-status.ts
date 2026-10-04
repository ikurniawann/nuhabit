/** Label + kelas badge status PO bahan baku dan PO vendor (produk/barang operasional). */

export type BadgeTone = { label: string; className: string };

const NEUTRAL = "bg-gray-100 text-gray-800";

const PO_STATUS: Record<string, BadgeTone> = {
  draft: { label: "Draf", className: "bg-gray-100 text-gray-800" },
  pending_approval: { label: "Menunggu Persetujuan", className: "bg-yellow-100 text-yellow-800" },
  approved: { label: "Disetujui", className: "bg-blue-100 text-blue-800" },
  sent: { label: "Terkirim", className: "bg-purple-100 text-purple-800" },
  partial: { label: "Diterima Sebagian", className: "bg-yellow-100 text-yellow-800" },
  partially_received: { label: "Diterima Sebagian", className: "bg-yellow-100 text-yellow-800" },
  received: { label: "Selesai", className: "bg-green-100 text-green-800" },
  rejected: { label: "Ditolak", className: "bg-red-100 text-red-800" },
  cancelled: { label: "Dibatalkan", className: "bg-red-100 text-red-800" },
  closed: { label: "Ditutup", className: "bg-slate-100 text-slate-800" },
};

/**
 * Badge status PO bahan baku. Halaman detail menyebut status `received` "Diterima Penuh",
 * daftar PO menyebutnya "Selesai".
 */
export function poStatusBadge(status: string, context: "list" | "detail" = "list"): BadgeTone {
  const normalized = status.toLowerCase();
  if (normalized === "received" && context === "detail") {
    return { ...PO_STATUS.received, label: "Diterima Penuh" };
  }
  return PO_STATUS[normalized] ?? { label: status, className: NEUTRAL };
}

const LIFECYCLE: Record<string, BadgeTone> = {
  draft: { label: "Draf", className: "bg-gray-100 text-gray-700" },
  in_progress: { label: "Sedang Berjalan", className: "bg-blue-100 text-blue-700" },
  waiting_payment: { label: "Menunggu Pembayaran", className: "bg-amber-100 text-amber-700" },
  waiting_receipt: { label: "Menunggu Penerimaan", className: "bg-purple-100 text-purple-700" },
  completed: { label: "Selesai", className: "bg-emerald-100 text-emerald-700" },
  cancelled: { label: "Dibatalkan", className: "bg-red-100 text-red-700" },
};

export function poLifecycleBadge(lifecycle: string | null | undefined): BadgeTone {
  const key = lifecycle || "in_progress";
  return LIFECYCLE[key] ?? { label: key, className: "bg-blue-100 text-blue-700" };
}

const PAYMENT_STATUS: Record<string, BadgeTone> = {
  unpaid: { label: "Belum Dibayar", className: "bg-gray-100 text-gray-700" },
  partial: { label: "Dibayar Sebagian", className: "bg-amber-100 text-amber-700" },
  paid: { label: "Lunas", className: "bg-emerald-100 text-emerald-700" },
  overdue: { label: "Terlambat", className: "bg-red-100 text-red-700" },
};

export function paymentStatusBadge(status: string | null | undefined): BadgeTone {
  const key = status || "unpaid";
  return PAYMENT_STATUS[key] ?? { label: key, className: "bg-gray-100 text-gray-700" };
}

const VENDOR_PO_STATUS: Record<string, BadgeTone> = {
  draft: { label: "Draf", className: "bg-gray-100 text-gray-700" },
  approved: { label: "Disetujui", className: "bg-emerald-100 text-emerald-800" },
  sent: { label: "Dikirim", className: "bg-blue-100 text-blue-800" },
  partially_received: { label: "Diterima Sebagian", className: "bg-amber-100 text-amber-800" },
  partial: { label: "Diterima Sebagian", className: "bg-amber-100 text-amber-800" },
  received: { label: "Diterima", className: "bg-green-100 text-green-800" },
  cancelled: { label: "Dibatalkan", className: "bg-red-100 text-red-800" },
};

/** Badge status PO produk & barang operasional (tabel vendors). */
export function vendorPoStatusBadge(status: string): BadgeTone {
  return VENDOR_PO_STATUS[status] ?? { label: status.replace(/_/g, " "), className: "bg-gray-100 text-gray-700" };
}

export const VENDOR_PO_STATUS_OPTIONS = [
  { value: "all", label: "Semua Status" },
  { value: "draft", label: "Draf" },
  { value: "approved", label: "Disetujui" },
  { value: "sent", label: "Dikirim" },
  { value: "partially_received", label: "Diterima Sebagian" },
  { value: "received", label: "Diterima" },
  { value: "cancelled", label: "Dibatalkan" },
];

const SHIPPABLE = ["approved", "sent", "partial", "partially_received"];
const PARTIAL = ["partial", "partially_received"];

/** PO yang sudah disetujui dan belum selesai diterima boleh punya pengiriman. */
export function canTrackShipment(status: string): boolean {
  return SHIPPABLE.includes(status.toLowerCase());
}

export function isPartiallyReceived(status: string): boolean {
  return PARTIAL.includes(status.toLowerCase());
}

/** Kirim ulang sisa qty hanya bila PO diterima sebagian dan tidak ada pengiriman aktif. */
export function canReshipPurchaseOrder(po: { status: string; active_delivery_id?: string | null }): boolean {
  return isPartiallyReceived(po.status) && !po.active_delivery_id;
}

/** PO masih bisa dibatalkan selama belum diterima penuh, dibatalkan, atau ditutup. */
export function canCancelPurchaseOrder(status: string, { allowClosed = false } = {}): boolean {
  const normalized = status.toLowerCase();
  if (normalized === "received" || normalized === "cancelled") return false;
  return allowClosed || normalized !== "closed";
}

export const SEND_VIA_OPTIONS = [
  { value: "EMAIL", label: "Email" },
  { value: "WHATSAPP", label: "WhatsApp" },
  { value: "PRINT", label: "Cetak / Manual" },
  { value: "OTHER", label: "Lainnya" },
] as const;

export type SendVia = (typeof SEND_VIA_OPTIONS)[number]["value"];
