export const ORDER_STATUS_TABS = [
  { value: "", label: "Semua" },
  { value: "pending", label: "Menunggu Bayar" },
  { value: "paid", label: "Dibayar" },
  { value: "packing", label: "Dikemas" },
  { value: "shipped", label: "Dikirim" },
  { value: "completed", label: "Selesai" },
  { value: "cancelled", label: "Batal" },
];

const STATUS_TONE: Record<string, string> = {
  pending: "bg-amber-50 text-amber-700",
  paid: "bg-green-50 text-green-700",
  packing: "bg-blue-50 text-blue-700",
  shipped: "bg-indigo-50 text-indigo-700",
  completed: "bg-green-100 text-green-800",
  cancelled: "bg-red-50 text-red-600",
  refund: "bg-gray-100 text-gray-600",
};

export const orderStatusTone = (status: string) => STATUS_TONE[status] || "bg-gray-100 text-gray-600";

export const courierLabel = (order: { courier_code: string | null; courier_service: string | null }) =>
  [order.courier_code, order.courier_service].filter(Boolean).join(" ") || "—";
