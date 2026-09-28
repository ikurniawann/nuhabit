/** Teks & progres status pesanan utk layar pelacakan self-order (bahasa pemesan). */

/** static_qris = gambar QRIS statis venue + bukti bayar diverifikasi kasir. */
export type TableOrderPaymentMethod = "qris" | "static_qris" | "ark_coin" | "cashier";
export type TableOrderType = "dine_in" | "takeaway";

export const ORDER_PROGRESS_STEPS = [
  { key: "pending", label: "Diterima" },
  { key: "confirmed", label: "Dikonfirmasi" },
  { key: "preparing", label: "Disiapkan" },
  { key: "ready", label: "Siap" },
  { key: "completed", label: "Selesai" },
] as const;

/** Indeks langkah progres; -1 = dibatalkan/void (tidak ada progres). */
export function orderProgressStep(status: string | null | undefined): number {
  const value = String(status || "pending").toLowerCase();
  if (value === "cancelled" || value === "voided" || value === "merged") return -1;
  if (value === "served" || value === "completed") return 4;
  if (value === "ready") return 3;
  if (value === "preparing") return 2;
  if (value === "confirmed") return 1;
  return 0;
}

export function orderStatusText(status: string | null | undefined) {
  switch (String(status || "pending").toLowerCase()) {
    case "pending":
      return "Menunggu diproses";
    case "confirmed":
      return "Pesanan dikonfirmasi";
    case "preparing":
      return "Sedang disiapkan";
    case "ready":
      return "Siap diantar";
    case "served":
      return "Sudah diantar";
    case "completed":
      return "Selesai";
    case "cancelled":
      return "Dibatalkan";
    case "voided":
      return "Dibatalkan (void)";
    default:
      return String(status);
  }
}

export function paymentStatusText(status: string | null | undefined) {
  switch (String(status || "unpaid").toLowerCase()) {
    case "paid":
      return "Sudah dibayar";
    case "partial":
      return "Sebagian dibayar";
    case "refunded":
      return "Dikembalikan";
    default:
      return "Belum dibayar";
  }
}

export function paymentMethodText(method: string | null | undefined) {
  switch (String(method || "").toLowerCase()) {
    case "qris":
      return "QRIS";
    case "static_qris":
      return "Static QRIS";
    case "ark_coin":
      return "ARK Coin";
    case "cashier":
      return "Bayar di kasir";
    default:
      return method ? String(method) : "—";
  }
}

export function orderTypeText(type: string | null | undefined) {
  return String(type || "dine_in").toLowerCase() === "takeaway" ? "Bawa pulang" : "Makan di tempat";
}

/** Order aktif = masih layak dipantau (belum selesai/batal). */
export function isOrderActive(status: string | null | undefined) {
  const step = orderProgressStep(status);
  return step >= 0 && step < 4;
}

/**
 * Alur bayar yang dipilih pemesan, dari penanda `payment=<flow>` di
 * special_requests order self-order (kolom payment_method baru terisi saat lunas).
 */
export function paymentFlowFrom(specialRequests: string | null | undefined, paymentMethod?: string | null) {
  const match = /payment=([a-z_]+)/i.exec(specialRequests || "");
  return match ? match[1].toLowerCase() : paymentMethod || "cashier";
}
