export type CashierPageVariant = "embedded" | "fullscreen";

/** Kasir placeholder; server memakai karyawan dari sesi login (resolveCashierId). */
export const CASHIER_ID = "00000000-0000-0000-0000-000000000001";

export const CASHIER_ROUTES = {
  embedded: "/dashboard/pos/cashier-new",
  fullscreen: "/dashboard/pos/cashier-fullscreen",
} as const;

/** Bookmark / home-screen friendly entry for tablet cashiers */
export const CASHIER_TABLET_ROUTE = "/dashboard/pos/tablet";

export const RESTAURANT_ROUTE = "/dashboard/pos/restaurant";
export const POS_ORDERS_PATH = "/dashboard/pos/orders";

export function buildPosOrdersUrl(input?: {
  from?: "cashier" | "restaurant";
  tablet?: boolean;
}): string {
  const params = new URLSearchParams();
  if (input?.from) params.set("from", input.from);
  if (input?.tablet) {
    params.set("tablet", "1");
    params.set("immersive", "1");
  }
  const query = params.toString();
  return query ? `${POS_ORDERS_PATH}?${query}` : POS_ORDERS_PATH;
}

function isOrdersTabletReturn(searchParams: {
  get(name: string): string | null;
}): boolean {
  return (
    searchParams.get("tablet") === "1" ||
    searchParams.get("tablet") === "true" ||
    searchParams.get("immersive") === "1"
  );
}

export function cashierHomeFromOrders(searchParams: {
  get(name: string): string | null;
}): string {
  return isOrdersTabletReturn(searchParams)
    ? `${CASHIER_ROUTES.fullscreen}?tablet=1&immersive=1`
    : CASHIER_ROUTES.embedded;
}

export function restaurantHomeFromOrders(searchParams: {
  get(name: string): string | null;
}): string {
  return isOrdersTabletReturn(searchParams)
    ? "/dashboard/pos/restaurant-tablet"
    : RESTAURANT_ROUTE;
}

export function posHomeFromOrders(searchParams: {
  get(name: string): string | null;
}): { href: string; label: string } | null {
  const from = searchParams.get("from");
  if (from === "restaurant") {
    return {
      href: restaurantHomeFromOrders(searchParams),
      label: "Kembali ke Restaurant",
    };
  }
  if (from === "cashier") {
    return {
      href: cashierHomeFromOrders(searchParams),
      label: "Kembali ke POS",
    };
  }
  return null;
}

/** Masuk POS dari menu (tanpa handoff) harus keranjang kosong. */
export function shouldResetCashierSession(searchParams: {
  get(name: string): string | null;
}): boolean {
  return !searchParams.get("checkoutId")
    && !searchParams.get("orderId")
    && !searchParams.get("tableId");
}

export function cashierRoute(
  variant: CashierPageVariant,
  searchParams?: URLSearchParams | string
) {
  const base = CASHIER_ROUTES[variant];
  if (!searchParams) return base;
  const query =
    typeof searchParams === "string" ? searchParams : searchParams.toString();
  return query ? `${base}?${query}` : base;
}
