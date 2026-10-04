// Aturan murni dashboard POS: rentang periode (WIB), ringkasan penjualan,
// produk terlaris, dan tren per jam/hari.
import { firstDayOfMonthWib, todayWib } from "@/lib/pos/report-dates";

export type DashboardPeriod = "today" | "week" | "month" | "custom";

const DAY_MS = 24 * 60 * 60 * 1000;
const WIB = "Asia/Jakarta";

/** Order dibatalkan/di-void/di-merge: uangnya tidak dihitung sebagai revenue. */
export const VOIDED_STATUSES = ["cancelled", "voided", "merged"] as const;
const VOIDED = new Set<string>(VOIDED_STATUSES);

export const toNumber = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const wibMidnight = (dateKey: string) => new Date(`${dateKey}T00:00:00+07:00`);

/**
 * Rentang custom (permintaan owner 2026-08-23): YYYY-MM-DD, batas hari penuh
 * WIB, inklusif dua sisi. null bila format/urutan tidak valid; maks 366 hari.
 */
export function customRange(dateFrom: string, dateTo: string): { startDate: Date; endDate: Date } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(dateTo)) return null;
  const startDate = wibMidnight(dateFrom);
  const endDate = new Date(`${dateTo}T23:59:59.999+07:00`);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return null;
  if (endDate < startDate) return null;
  if (endDate.getTime() - startDate.getTime() > 366 * DAY_MS) return null;
  return { startDate, endDate };
}

/** Awal periode berjalan di kalender WIB (hari ini / Senin minggu ini / tgl 1) sampai `now`. */
export function periodRange(period: Exclude<DashboardPeriod, "custom">, now = new Date()) {
  const today = todayWib(now);
  if (period === "today") return { startDate: wibMidnight(today), endDate: now };
  if (period === "month") return { startDate: wibMidnight(firstDayOfMonthWib(now)), endDate: now };
  const daysSinceMonday = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7;
  return { startDate: new Date(wibMidnight(today).getTime() - daysSinceMonday * DAY_MS), endDate: now };
}

/** Periode pembanding: durasi sama, tepat sebelum periode berjalan. */
export function previousRange(startDate: Date, endDate: Date) {
  const duration = endDate.getTime() - startDate.getTime();
  return { prevStart: new Date(startDate.getTime() - duration), prevEnd: new Date(startDate.getTime() - 1) };
}

export type DashboardOrderRow = {
  id: string;
  total_amount?: number | string | null;
  cashier_id?: string | null;
  ordered_at: string;
  ark_coins_used?: number | string | null;
  payment_method?: string | null;
  status?: string | null;
  payment_status?: string | null;
};

/**
 * Revenue = order yang DIBAYAR. Status order sengaja tidak dipakai: kasir
 * membuat order paid berstatus 'pending' sampai KDS men-serve semua item.
 */
export const isRevenueOrder = (order: DashboardOrderRow) =>
  order.payment_status === "paid" && !VOIDED.has(String(order.status));

const round1 = (value: number) => Math.round(value * 10) / 10;
const percentChange = (current: number, previous: number) =>
  previous > 0 ? round1(((current - previous) / previous) * 100) : 0;

export function summarizeSales(
  periodOrders: DashboardOrderRow[],
  previous: { revenue: number; orders: number }
) {
  const paid = periodOrders.filter(isRevenueOrder);
  const revenue = paid.reduce((sum, order) => sum + toNumber(order.total_amount), 0);
  return {
    todayRevenue: revenue,
    todayOrders: paid.length,
    averageOrderValue: Math.round(paid.length > 0 ? revenue / paid.length : 0),
    activeCashiers: new Set(periodOrders.map((order) => order.cashier_id).filter(Boolean)).size,
    revenueChange: percentChange(revenue, previous.revenue),
    ordersChange: percentChange(paid.length, previous.orders),
  };
}

export type DashboardItemRow = {
  order_id: string;
  product_id?: string | null;
  product_name?: string | null;
  quantity?: number | string | null;
  total_amount?: number | string | null;
};

/** 5 produk terlaris (qty) — hanya item milik order yang dibayar. */
export function topProducts(items: DashboardItemRow[], paidOrderIds: Set<string>) {
  const byProduct = new Map<string, { name: string; sold: number; revenue: number }>();
  for (const item of items) {
    if (!paidOrderIds.has(String(item.order_id))) continue;
    const id = String(item.product_id);
    const entry = byProduct.get(id) ?? { name: item.product_name || "Unknown", sold: 0, revenue: 0 };
    entry.sold += toNumber(item.quantity);
    entry.revenue += toNumber(item.total_amount);
    byProduct.set(id, entry);
  }
  return [...byProduct.entries()]
    .map(([id, product]) => ({ id, ...product }))
    .sort((a, b) => b.sold - a.sold)
    .slice(0, 5);
}

type TrendBucket = { revenue: number; orders: number; arkUsed: number; xpEarned: number };
const emptyBucket = (): TrendBucket => ({ revenue: 0, orders: 0, arkUsed: 0, xpEarned: 0 });

const wibHour = (iso: string | Date) =>
  Number(new Date(iso).toLocaleString("en-US", { timeZone: WIB, hour: "2-digit", hour12: false })) % 24;
const hourLabel = (hour: number) => `${String(hour).padStart(2, "0")}:00`;
const wibDateKey = (iso: string | Date) => todayWib(new Date(iso));

/** Tren per jam (periode hari ini) atau per hari, semua bucket memakai jam/tanggal WIB. */
export function buildTrend(input: {
  period: DashboardPeriod;
  startDate: Date;
  endDate: Date;
  paidOrders: DashboardOrderRow[];
  xpRows: Array<{ xp_earned: number; created_at: string }>;
  now?: Date;
}) {
  const hourly = input.period === "today";
  const keyOf = (iso: string) => (hourly ? hourLabel(wibHour(iso)) : wibDateKey(iso));
  const buckets = new Map<string, TrendBucket>();
  const bucket = (key: string) => {
    const existing = buckets.get(key) ?? emptyBucket();
    buckets.set(key, existing);
    return existing;
  };
  for (const order of input.paidOrders) {
    const b = bucket(keyOf(order.ordered_at));
    b.revenue += toNumber(order.total_amount);
    b.orders += 1;
    b.arkUsed += toNumber(order.ark_coins_used);
  }
  for (const row of input.xpRows) bucket(keyOf(row.created_at)).xpEarned += toNumber(row.xp_earned);

  if (hourly) {
    const lastHour = wibHour(input.now ?? new Date());
    return Array.from({ length: lastHour + 1 }, (_, hour) => ({
      label: hourLabel(hour),
      ...(buckets.get(hourLabel(hour)) ?? emptyBucket()),
    }));
  }
  const points: Array<TrendBucket & { label: string }> = [];
  const lastKey = wibDateKey(input.endDate);
  for (let day = wibMidnight(wibDateKey(input.startDate)); ; day = new Date(day.getTime() + DAY_MS)) {
    const key = wibDateKey(day);
    if (key > lastKey) break;
    const label = day.toLocaleDateString("id-ID", { timeZone: WIB, day: "numeric", month: "short" });
    points.push({ label, ...(buckets.get(key) ?? emptyBucket()) });
  }
  return points;
}
