import { canRenamePaymentMethodCode } from "@/lib/pos/payment-methods";

/** Label laporan transaksi: bayar vs dapur, jangan campur. */

const PAYMENT_STATUS_LABEL: Record<string, string> = {
  paid: "Lunas",
  unpaid: "Belum lunas",
  partial: "Sebagian",
  refunded: "Refund",
};

const PAYMENT_METHOD_LABEL: Record<string, string> = {
  cash: "Tunai",
  qris: "QRIS",
  credit: "Kartu",
  credit_card: "Kartu",
  debit: "Kartu debit",
  ark_coin: "ARK Coin",
  nfc_tab: "NFC Tab",
  member_bill: "Tagihan Member",
  gift_card: "Gift card",
};

const KITCHEN_STATUS_LABEL: Record<string, string> = {
  pending: "Antrian dapur",
  confirmed: "Dikonfirmasi",
  preparing: "Dimasak",
  ready: "Siap diambil",
  served: "Disajikan",
  completed: "Selesai",
  cancelled: "Dibatalkan",
  voided: "Void",
  merged: "Digabung",
};

function key(value?: string | null) {
  return String(value || "").trim().toLowerCase();
}

export function formatPaymentStatusLabel(
  paymentStatus?: string | null,
  kitchenStatus?: string | null
) {
  const payment = key(paymentStatus);
  if (payment && PAYMENT_STATUS_LABEL[payment]) return PAYMENT_STATUS_LABEL[payment];
  const kitchen = key(kitchenStatus);
  if (kitchen === "completed") return "Lunas";
  if (kitchen === "cancelled" || kitchen === "voided") {
    return KITCHEN_STATUS_LABEL[kitchen];
  }
  return paymentStatus || kitchenStatus ? "Belum lunas" : "—";
}

export function formatPaymentMethodLabel(
  method?: string | null,
  catalog?: { name?: string | null; code?: string | null }
) {
  const catalogCode = key(catalog?.code);
  const catalogName = String(catalog?.name || "").trim();
  if (catalogName && catalogCode && canRenamePaymentMethodCode(catalogCode)) {
    return catalogName;
  }
  const value = key(method);
  if (!value) return catalogName || "—";
  return PAYMENT_METHOD_LABEL[value] || method || "—";
}

export function formatKitchenStatusLabel(status?: string | null) {
  const value = key(status);
  if (!value) return "—";
  return KITCHEN_STATUS_LABEL[value] || status || "—";
}

export function isPaidPaymentStatus(
  paymentStatus?: string | null,
  kitchenStatus?: string | null
) {
  return formatPaymentStatusLabel(paymentStatus, kitchenStatus) === "Lunas";
}

const ORDER_TYPE_LABEL: Record<string, string> = {
  dine_in: "Dine-in",
  takeaway: "Takeaway",
  delivery: "Delivery",
};

export function formatOrderTypeLabel(orderType?: string | null) {
  const value = key(orderType);
  if (!value) return "—";
  return ORDER_TYPE_LABEL[value] || orderType || "—";
}

export function formatSoldFromLabel(soldFrom?: string | null) {
  const value = key(soldFrom);
  if (value === "central") return "Kasir pusat";
  if (value === "stall") return "Kasir stall";
  return soldFrom?.trim() || "—";
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Jangan render UUID mentah di kolom Stall (layar, print, Excel). */
export function formatReportStallLabel(input: {
  stall_name?: string | null;
  stall_code?: string | null;
}) {
  const name = String(input.stall_name || "").trim();
  if (name && !UUID_RE.test(name)) return name;
  const code = String(input.stall_code || "").trim();
  if (code && !UUID_RE.test(code)) return code;
  return "—";
}

export function formatCompTypeLabel(compType?: string | null) {
  const value = key(compType);
  if (value === "kol_comp") return "KOL Comp";
  if (value === "foc_comp") return "FOC";
  if (value === "owner_comp") return "Owner Comp";
  return "";
}

export function isQrisPaymentMethod(method?: string | null) {
  return key(method) === "qris";
}

/** Hanya ID yang benar-benar tersimpan. Jangan tebak `pos-{orderId}` — QR stall pakai UUID acak. */
export function resolveXenditExternalId(input: {
  storedExternalId?: string | null;
}) {
  const stored = String(input.storedExternalId || "").trim();
  return stored || null;
}

export function formatXenditSettlementNote() {
  return "Xendit";
}

export function formatXenditPaymentLabel(
  paymentStatus?: string | null,
  kitchenStatus?: string | null
) {
  if (isPaidPaymentStatus(paymentStatus, kitchenStatus)) {
    return "Success";
  }
  return "Belum dibayar di Xendit";
}
