/**
 * POS tablet / kiosk chrome helpers.
 * Hides dashboard sidebar + top bar so kasir/restaurant fills the viewport.
 */

import { CASHIER_ROUTES, CASHIER_TABLET_ROUTE } from "@/features/pos/cashier/constants";
import { KDS_ROUTES } from "@/features/pos/kds/constants";
import {
  POS_TABLET_PARAM,
  RESTAURANT_IMMERSIVE_PARAM,
  RESTAURANT_PATH,
  RESTAURANT_TABLET_PATH,
  isRestaurantImmersive,
  isRestaurantTabletPath,
} from "@/features/pos/restaurant/nav";

export { POS_TABLET_PARAM };

/** CFD + TV antrian = monitor kedua di laptop. Jangan tampil di tablet/handheld. */
export function shouldShowSecondaryPosDisplays(input: {
  immersiveTablet: boolean;
  handheldClient: boolean;
}): boolean {
  return !input.immersiveTablet && !input.handheldClient;
}

/** `/pos/kds`, `/pos/queue`, CFD — luar layout dashboard. Jangan `<Link>` (RSC gagal). */
export function isPosChromeLessPath(href: string): boolean {
  const path = href.split("?")[0] ?? "";
  return path === "/pos" || path.startsWith("/pos/");
}

const POS_DASHBOARD_PREFIX = "/dashboard/pos";

export function isPosDashboardPath(href: string): boolean {
  const path = href.split("?")[0] ?? "";
  return path === POS_DASHBOARD_PREFIX || path.startsWith(`${POS_DASHBOARD_PREFIX}/`);
}

/**
 * `dashboard/pos/layout` dan `dashboard/(dashboard)/layout` tidak berbagi parent.
 * Soft `<Link>` menyeberang keduanya → Next RSC `TypeError: network error`.
 */
export function needsCrossPosLayoutHardNav(fromPath: string, toHref: string): boolean {
  if (isPosChromeLessPath(toHref)) return true;
  return isPosDashboardPath(fromPath) !== isPosDashboardPath(toHref);
}

type SearchParamsLike = { get(name: string): string | null };

/** Query flag used across POS pages for tablet/kiosk shell. */
export function isPosTabletQuery(searchParams: SearchParamsLike): boolean {
  const value = searchParams.get(POS_TABLET_PARAM);
  return value === "1" || value === "true";
}

/**
 * When true, AppSidebar renders children only (no nav chrome).
 * Covers dedicated tablet routes + ?tablet=1 / ?immersive=1 on POS pages.
 */
export function isPosImmersiveShell(
  pathname: string,
  searchParams: SearchParamsLike
): boolean {
  if (pathname === CASHIER_ROUTES.fullscreen) return true;
  if (pathname === CASHIER_TABLET_ROUTE) return true;
  if (pathname === KDS_ROUTES.fullscreen) return true;
  if (isRestaurantTabletPath(pathname)) return true;

  if (!pathname.startsWith("/dashboard/pos")) return false;

  if (isPosTabletQuery(searchParams)) return true;

  if (pathname === RESTAURANT_PATH && isRestaurantImmersive(searchParams)) {
    return true;
  }

  // Cashier handoff from restaurant immersive keeps immersive/tablet flags
  if (searchParams.get(RESTAURANT_IMMERSIVE_PARAM) === "1") return true;
  if (isPosTabletQuery(searchParams)) return true;

  return false;
}

export function withPosTabletParam(href: string, enabled = true): string {
  if (!enabled) return href;
  const url = new URL(href, "http://local.invalid");
  url.searchParams.set(POS_TABLET_PARAM, "1");
  return `${url.pathname}${url.search}${url.hash}`;
}

export function cashierTabletRoute(searchParams?: URLSearchParams | string): string {
  const base = CASHIER_ROUTES.fullscreen;
  if (!searchParams) return `${base}?${POS_TABLET_PARAM}=1`;
  const params =
    typeof searchParams === "string"
      ? new URLSearchParams(searchParams)
      : new URLSearchParams(searchParams.toString());
  params.set(POS_TABLET_PARAM, "1");
  const query = params.toString();
  return query ? `${base}?${query}` : `${base}?${POS_TABLET_PARAM}=1`;
}

/** Dashboard kasir tanpa flag tablet/immersive (Keluar layar penuh). */
export function cashierDesktopRoute(searchParams?: URLSearchParams | string): string {
  const params =
    !searchParams
      ? new URLSearchParams()
      : typeof searchParams === "string"
        ? new URLSearchParams(searchParams)
        : new URLSearchParams(searchParams.toString());
  params.delete(POS_TABLET_PARAM);
  params.delete(RESTAURANT_IMMERSIVE_PARAM);
  const query = params.toString();
  return query ? `${CASHIER_ROUTES.embedded}?${query}` : CASHIER_ROUTES.embedded;
}

export function restaurantTabletRoute(): string {
  return RESTAURANT_TABLET_PATH;
}
