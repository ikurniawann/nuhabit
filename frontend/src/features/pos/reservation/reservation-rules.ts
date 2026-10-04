// Aturan murni halaman Reservasi: label status, ringkasan antrian, grup meja
// per lantai, form reservasi baru, dan pesan WhatsApp.
import { brandName } from "@/lib/branding";
import { formatDateLong, formatRupiah } from "@/lib/format";
import { buildReservationQueueWaMessage, formatReservationQueueNumber } from "@/lib/pos/reservation-queue";
import { floorLabel, floorSortKey } from "@/features/pos/tables/floor-options";
import type {
  CreateReservationPayload,
  OrderType,
  ReservationCustomer,
  ReservationRow,
  ReservationStatus,
  ReservationTable,
} from "./types";

export const TIME_SLOT_OPTIONS = Array.from({ length: 23 }, (_, index) => {
  const minutes = 10 * 60 + index * 30;
  const slot = `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${minutes % 60 === 0 ? "00" : "30"}`;
  return { value: slot, label: slot };
});

export const STATUS_FILTERS = ["all", "pending", "confirmed", "seated", "completed"] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];

export const ORDER_TYPES: Array<{ value: OrderType; label: string }> = [
  { value: "dine_in", label: "Dine-in" },
  { value: "takeaway", label: "Takeaway" },
  { value: "delivery", label: "Delivery" },
];

export const DEPOSIT_PRESETS = [0, 25000, 50000, 100000];

const STATUS_META: Record<ReservationStatus, { label: string; className: string }> = {
  pending: { label: "Pending", className: "border-amber-200/80 bg-amber-50 text-amber-800" },
  confirmed: { label: "Confirmed", className: "border-sky-200/80 bg-sky-50 text-sky-800" },
  seated: { label: "Seated", className: "border-emerald-200/80 bg-emerald-50 text-emerald-800" },
  completed: { label: "Completed", className: "border-gray-200/80 bg-muted/60 text-muted-foreground" },
  cancelled: { label: "Cancelled", className: "border-red-200/80 bg-red-50 text-red-700" },
  no_show: { label: "No show", className: "border-red-200/80 bg-red-50 text-red-700" },
};

export const statusMeta = (status: ReservationStatus) => STATUS_META[status];

export const statusFilterLabel = (status: StatusFilter) => (status === "all" ? "All" : STATUS_META[status].label);

export const STATUS_UPDATED_MESSAGE: Partial<Record<ReservationStatus, string>> = {
  confirmed: "Reservation confirmed",
  seated: "Guest seated",
  completed: "Reservation completed",
  cancelled: "Reservation cancelled",
  no_show: "Marked as no show",
};

export const reservationName = (row: ReservationRow) => row.customer?.name || row.customer_name || "Guest";
export const reservationPhone = (row: ReservationRow) => row.customer?.phone || row.customer_phone || "—";
export const reservationTime = (row: ReservationRow) => String(row.time_slot || "").slice(0, 5);
export const tableDisplayName = (table: ReservationTable) => table.label || table.table_number || table.name || "Table";

/** Tanggal lokal perangkat kasir dalam format YYYY-MM-DD. */
export function localDateKey(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function sortByTimeSlot(rows: ReservationRow[]): ReservationRow[] {
  return [...rows].sort((a, b) => String(a.time_slot || "").localeCompare(String(b.time_slot || "")));
}

/**
 * Kartu ringkasan antrian (owner 2026-08-16): sedang dilayani, siapa yang
 * harus siap-siap, dan berapa yang menunggu. Dihitung dari SEMUA reservasi
 * tanggal terpilih, bukan subset filter chip.
 */
export function summarizeQueue(rows: ReservationRow[]) {
  const withQueue = rows.filter((r) => Number(r.queue_number) > 0);
  const waiting = withQueue
    .filter((r) => r.status === "pending" || r.status === "confirmed")
    .sort((a, b) => Number(a.queue_number) - Number(b.queue_number));
  const served = withQueue
    .filter((r) => r.status === "seated" || r.status === "completed")
    .sort((a, b) => Number(b.queue_number) - Number(a.queue_number));
  return { nowServing: served[0] ?? null, next: waiting[0] ?? null, waitingCount: waiting.length };
}

export function groupTablesByFloor(tables: ReservationTable[]) {
  const map = new Map<string, ReservationTable[]>();
  for (const table of tables) {
    if (table.is_active === false) continue;
    const key = String(table.floor ?? "").trim();
    map.set(key, [...(map.get(key) ?? []), table]);
  }
  return [...map.entries()]
    .sort(([a], [b]) => floorSortKey(a) - floorSortKey(b))
    .map(([floorKey, group]) => ({
      floorKey,
      label: floorLabel(floorKey),
      tables: [...group].sort((a, b) =>
        tableDisplayName(a).localeCompare(tableDisplayName(b), undefined, { numeric: true })
      ),
    }));
}

export function filterCustomers(customers: ReservationCustomer[], search: string) {
  const query = search.trim().toLowerCase();
  if (!query) return customers;
  return customers.filter((customer) => `${customer.name || ""} ${customer.phone}`.toLowerCase().includes(query));
}

// ── Form reservasi baru ─────────────────────────────────────────────────────

export type ReservationForm = {
  customerId: string | null;
  customerName: string;
  customerPhone: string;
  date: string;
  time: string;
  guestCount: number;
  tableId: string | null;
  notes: string;
  deposit: number;
  orderType: OrderType;
};

export function emptyReservationForm(date: string): ReservationForm {
  return {
    customerId: null,
    customerName: "",
    customerPhone: "",
    date,
    time: "12:00",
    guestCount: 2,
    tableId: null,
    notes: "",
    deposit: 0,
    orderType: "dine_in",
  };
}

export const isReservationFormComplete = (form: ReservationForm) =>
  Boolean(form.customerName.trim() && form.date && form.time);

/** Jenis order disimpan di kolom special_requests (kontrak API lama). */
export function reservationPayload(form: ReservationForm): CreateReservationPayload {
  return {
    table_id: form.tableId,
    customer_id: form.customerId,
    customer_name: form.customerName.trim(),
    customer_phone: form.customerPhone.trim(),
    reservation_date: form.date,
    time_slot: form.time,
    pax_count: form.guestCount,
    special_requests: form.orderType,
    deposit_amount: form.deposit,
    notes: form.notes,
  };
}

export const depositLabel = (amount: number) => (amount === 0 ? "None" : formatRupiah(amount));

// ── WhatsApp ────────────────────────────────────────────────────────────────

export type WhatsAppKind = "reminder" | "confirmation" | "queue";

export function queueSlipFields(reservation: ReservationRow) {
  return {
    guestName: reservationName(reservation),
    paxCount: reservation.pax_count,
    dateLabel: formatDateLong(reservation.reservation_date),
    timeLabel: reservationTime(reservation),
    tableLabel: reservation.table?.table_number || null,
  };
}

export function whatsAppMessage(reservation: ReservationRow, kind: WhatsAppKind): string {
  if (kind === "queue") {
    return buildReservationQueueWaMessage({
      ...queueSlipFields(reservation),
      queueLabel: formatReservationQueueNumber(reservation.queue_number) ?? "-",
      merchantName: "NüHabit",
    });
  }
  const intro =
    kind === "confirmation" ? "Your reservation has been confirmed:" : "This is a reminder for your reservation:";
  const table = reservation.table?.table_number ? `Table: ${reservation.table.table_number}\n` : "";
  const notes = reservation.notes ? `Notes: ${reservation.notes}\n` : "";
  return `Hello ${reservationName(reservation)}!\n\n${intro}\n\nDate: ${formatDateLong(reservation.reservation_date)}\nTime: ${reservation.time_slot}\nGuests: ${reservation.pax_count}\n${table}${notes}\nPlease arrive 10 minutes before your reservation time.\n\n${brandName()}`;
}

/** Nomor tamu → format wa.me (08xx → 628xx); null bila tidak ada digit. */
export function whatsAppPhone(reservation: ReservationRow): string | null {
  const digits = reservationPhone(reservation).replace(/[^0-9]/g, "");
  if (!digits) return null;
  return digits.startsWith("0") ? `62${digits.slice(1)}` : digits;
}
