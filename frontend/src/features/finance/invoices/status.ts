// Label dan warna status invoice B2B, dipakai Finance dan pipeline sales.

export const INVOICE_STATUS_BADGES: Record<string, string> = {
  diajukan: "bg-amber-100 text-amber-700",
  draft: "bg-gray-100 text-gray-600",
  terkirim: "bg-blue-100 text-blue-700",
  batal: "bg-red-100 text-red-600",
};

export const INVOICE_PAYMENT_BADGES: Record<string, string> = {
  lunas: "bg-emerald-100 text-emerald-700",
  sebagian: "bg-amber-100 text-amber-700",
  belum: "bg-gray-100 text-gray-500",
};

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: "Tunai",
  transfer: "Transfer",
  qris: "QRIS",
  edc: "Kartu / EDC",
  lainnya: "Lainnya",
};
