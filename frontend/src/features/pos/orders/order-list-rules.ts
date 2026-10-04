// Aturan murni daftar Orders: status bayar, filter, periode, paginasi.
import { firstDayOfMonthWib, todayWib } from "@/lib/pos/report-dates";
import type { Order, OrderListParams } from "./types";

/** Lunas = dibayar/selesai dan bukan void/cancel. */
export function isPaid(order: Order): boolean {
  return (
    (order.payment_status === "paid" || order.status === "completed") &&
    order.status !== "voided" &&
    order.status !== "cancelled"
  );
}

/** Belum bayar yang MASIH hidup — void/cancel/merged bukan "belum bayar". */
export function isUnpaid(order: Order): boolean {
  return !isPaid(order) && !["voided", "cancelled", "merged"].includes(String(order.status || ""));
}

/** Order yang dapurnya masih jalan — apa pun status bayarnya. */
export function isKitchenOpen(order: Order): boolean {
  return ["pending", "preparing", "ready"].includes(String(order.status || ""));
}

// Filter berbasis pembayaran (EPIC-041 task 6). "kitchen_open" menggantikan
// pending/preparing/ready yang ambigu.
export const STATUS_FILTERS = [
  { key: "all", label: "Semua", tone: "text-foreground" },
  { key: "paid", label: "Lunas", tone: "text-emerald-700" },
  { key: "unpaid", label: "Belum bayar", tone: "text-amber-700" },
  { key: "kitchen_open", label: "Dapur belum selesai", tone: "text-sky-700" },
  { key: "voided", label: "Void", tone: "text-muted-foreground" },
] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number]["key"];

const MATCHERS: Record<StatusFilter, (order: Order) => boolean> = {
  all: () => true,
  paid: isPaid,
  unpaid: isUnpaid,
  kitchen_open: isKitchenOpen,
  voided: (order) => order.status === "voided",
};

export function countByStatus(orders: Order[]): Record<StatusFilter, number> {
  const counts = { all: 0, paid: 0, unpaid: 0, kitchen_open: 0, voided: 0 };
  for (const order of orders) {
    for (const key of Object.keys(counts) as StatusFilter[]) {
      if (MATCHERS[key](order)) counts[key] += 1;
    }
  }
  return counts;
}

export function filterOrders(orders: Order[], search: string, status: StatusFilter): Order[] {
  const q = search.trim().toLowerCase();
  return orders.filter((order) => {
    const matchesSearch =
      !q ||
      order.order_number?.toLowerCase().includes(q) ||
      order.checkout_number?.toLowerCase().includes(q) ||
      order.queue_number?.toLowerCase().includes(q) ||
      order.customer?.name?.toLowerCase().includes(q) ||
      order.cashier_id?.toLowerCase().includes(q);
    return Boolean(matchesSearch) && MATCHERS[status](order);
  });
}

/**
 * Keputusan owner 2026-08-23: TANPA batasan — semua order sesuai filter
 * dimuat. Server memagari di 10.000 baris demi keselamatan browser.
 */
export const ORDER_LIST_LIMIT = 10_000;

export type PeriodPreset = "today" | "7d" | "month";
export const PERIOD_PRESETS: Array<{ key: PeriodPreset; label: string }> = [
  { key: "today", label: "Hari ini" },
  { key: "7d", label: "7 hari" },
  { key: "month", label: "Bulan ini" },
];

export function shiftIsoDate(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function periodRange(preset: PeriodPreset, now = new Date()) {
  const today = todayWib(now);
  if (preset === "today") return { date_from: today, date_to: today };
  if (preset === "7d") return { date_from: shiftIsoDate(today, -6), date_to: today };
  return { date_from: firstDayOfMonthWib(now), date_to: today };
}

export type OrderFilterDraft = {
  date_from: string;
  date_to: string;
  payment_status: string;
  order_type: string;
  payment_method: string;
};

/** Draf filter → parameter query; galat bila tanggal dari > sampai. */
export function toOrderListParams(
  draft: OrderFilterDraft
): { ok: true; params: OrderListParams } | { ok: false; error: string } {
  if (draft.date_from && draft.date_to && draft.date_from > draft.date_to) {
    return { ok: false, error: "Tanggal dari tidak boleh melebihi tanggal sampai" };
  }
  return {
    ok: true,
    params: {
      date_from: draft.date_from,
      date_to: draft.date_to,
      payment_status: draft.payment_status || undefined,
      order_type: draft.order_type || undefined,
      payment_method: draft.payment_method || undefined,
      limit: ORDER_LIST_LIMIT,
    },
  };
}

export function paginate<T>(rows: T[], page: number, pageSize: number) {
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  return {
    pageCount,
    currentPage,
    rows: rows.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    firstIndex: (currentPage - 1) * pageSize + 1,
    lastIndex: Math.min(currentPage * pageSize, rows.length),
  };
}

/** URL kasir untuk melanjutkan tagihan (checkoutId diutamakan atas orderId). */
export function cashierHandoffUrl(home: string, handoff: { checkoutId?: string; orderId?: string }): string {
  const url = new URL(home, "http://local.invalid");
  if (handoff.checkoutId) url.searchParams.set("checkoutId", handoff.checkoutId);
  else if (handoff.orderId) url.searchParams.set("orderId", handoff.orderId);
  return `${url.pathname}${url.search}`;
}
