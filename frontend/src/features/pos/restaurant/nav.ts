import { CASHIER_ROUTES, CASHIER_TABLET_ROUTE } from "@/features/pos/cashier/constants";

export const RESTAURANT_FROM = "restaurant";
export const RESTAURANT_PATH = "/dashboard/pos/restaurant";
export const RESTAURANT_TABLET_PATH = "/dashboard/pos/restaurant-tablet";
export const RESTAURANT_IMMERSIVE_PARAM = "immersive";
export const POS_TABLET_PARAM = "tablet";

type SearchParamsLike = { get(name: string): string | null };

function isTabletFlag(searchParams: SearchParamsLike): boolean {
  const value = searchParams.get(POS_TABLET_PARAM);
  return value === "1" || value === "true";
}

/** Immersive/tablet chrome for restaurant board (legacy ?immersive=1 or ?tablet=1). */
export function isRestaurantImmersive(searchParams: SearchParamsLike): boolean {
  if (isTabletFlag(searchParams)) return true;
  const immersive = searchParams.get(RESTAURANT_IMMERSIVE_PARAM);
  return immersive === "1" || immersive === "true";
}

export function isRestaurantTabletPath(pathname: string): boolean {
  return pathname === RESTAURANT_TABLET_PATH;
}

/** Meja → kasir tablet bila immersive ATAU device handheld (iPad tanpa ?tablet=1). */
export function shouldUseTabletCashierHandoff(input: {
  immersive: boolean;
  handheldClient: boolean;
}): boolean {
  return input.immersive || input.handheldClient;
}

export function restaurantPath(opts?: { immersive?: boolean }): string {
  if (opts?.immersive) {
    return RESTAURANT_TABLET_PATH;
  }
  return RESTAURANT_PATH;
}

export function buildCashierHandoffUrl(opts: {
  tableId?: string;
  orderId?: string;
  checkoutId?: string;
  orderType?: "dine_in" | "takeaway";
  pay?: boolean;
  immersive?: boolean;
  /** Jumlah tamu dari halaman Restaurant (EPIC-038) — masih bisa dikoreksi di kasir. */
  pax?: number;
}): string {
  const params = new URLSearchParams();
  params.set("from", RESTAURANT_FROM);
  if (opts.tableId) params.set("tableId", opts.tableId);
  // Hanya dioper bila > 1: "1" adalah default, dan URL yang bersih lebih mudah
  // dibaca saat menelusuri masalah.
  if (opts.pax && opts.pax > 1) params.set("pax", String(opts.pax));
  if (opts.checkoutId) {
    params.set("checkoutId", opts.checkoutId);
  } else if (opts.orderId) {
    params.set("orderId", opts.orderId);
  }
  if (opts.orderType) params.set("orderType", opts.orderType);
  if (opts.pay) params.set("pay", "1");
  if (opts.immersive) {
    params.set(POS_TABLET_PARAM, "1");
    params.set(RESTAURANT_IMMERSIVE_PARAM, "1");
  }

  const base = opts.immersive ? CASHIER_ROUTES.fullscreen : CASHIER_ROUTES.embedded;
  return `${base}?${params.toString()}`;
}

export { CASHIER_TABLET_ROUTE };
