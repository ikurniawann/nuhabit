export const ORDER_STATUS_TABS = [
  { value: "", label: "Semua" },
  { value: "pending", label: "Menunggu Bayar" },
  { value: "paid", label: "Dibayar" },
  { value: "packing", label: "Dikemas" },
  { value: "shipped", label: "Dikirim" },
  { value: "ready_for_pickup", label: "Siap Diambil" },
  { value: "picked_up", label: "Sudah Diambil" },
  { value: "completed", label: "Selesai" },
  { value: "cancelled", label: "Batal" },
];

const STATUS_TONE: Record<string, string> = {
  pending: "bg-amber-50 text-amber-700",
  paid: "bg-green-50 text-green-700",
  packing: "bg-blue-50 text-blue-700",
  shipped: "bg-indigo-50 text-indigo-700",
  ready_for_pickup: "bg-teal-50 text-teal-700",
  picked_up: "bg-green-100 text-green-800",
  completed: "bg-green-100 text-green-800",
  cancelled: "bg-red-50 text-red-600",
  refund: "bg-gray-100 text-gray-600",
};

const STATUS_LABEL: Record<string, string> = {
  ready_for_pickup: "siap diambil",
  picked_up: "sudah diambil",
};

export const orderStatusTone = (status: string) => STATUS_TONE[status] || "bg-gray-100 text-gray-600";

export const orderStatusLabel = (status: string) => STATUS_LABEL[status] ?? status;

type DeliveryFields = { delivery_method?: string | null; pickup_branch_name?: string | null };

export const isPickupOrder = (order: DeliveryFields) => order.delivery_method === "pickup";

export const courierLabel = (order: { courier_code: string | null; courier_service: string | null } & DeliveryFields) =>
  isPickupOrder(order)
    ? `Ambil di ${order.pickup_branch_name || "cabang"}`
    : [order.courier_code, order.courier_service].filter(Boolean).join(" ") || "—";
