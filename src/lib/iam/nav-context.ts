import { PRODUCT_ROUTES, RM_ROUTES } from "@/lib/purchasing/item-routes";

/** Query param: keep Approval PR menu active on PR detail routes. */
export const NAV_FROM_APPROVAL_PR = "approval-pr";

/** Query param: keep Approval PO menu active on PO detail routes. */
export const NAV_FROM_APPROVAL_PO = "approval-po";

const NAV_FROM_SESSION_KEY = "nav-from";

export function appendNavFrom(href: string, from: string): string {
  const separator = href.includes("?") ? "&" : "?";
  return `${href}${separator}from=${encodeURIComponent(from)}`;
}

export function purchaseRequestDetailFromApproval(
  detailHref: string,
  from: string = NAV_FROM_APPROVAL_PR
): string {
  return appendNavFrom(detailHref, from);
}

export function purchaseOrderDetailFromApproval(
  detailHref: string,
  from: string = NAV_FROM_APPROVAL_PO
): string {
  return appendNavFrom(detailHref, from);
}

/** Align legacy `/dashboard/purchasing/*` menu hrefs with raw-material canonical paths. */
export function normalizeMenuHref(href: string): string {
  if (href.startsWith("/dashboard/purchasing/approval/")) {
    return href.replace("/dashboard/purchasing/approval/", "/dashboard/raw-material/approval/");
  }
  if (
    href === "/dashboard/purchasing/pr" ||
    href.startsWith("/dashboard/purchasing/pr/")
  ) {
    return href.replace("/dashboard/purchasing/", "/dashboard/raw-material/purchasing/");
  }
  if (
    href === "/dashboard/purchasing/po" ||
    href.startsWith("/dashboard/purchasing/po/")
  ) {
    return href.replace("/dashboard/purchasing/", "/dashboard/raw-material/purchasing/");
  }
  return href;
}

export function normalizePurchasingPathname(pathname: string): string {
  if (pathname.startsWith("/dashboard/purchasing/approval/")) {
    return pathname.replace("/dashboard/purchasing/approval/", "/dashboard/raw-material/approval/");
  }
  if (
    pathname === "/dashboard/purchasing/pr" ||
    pathname.startsWith("/dashboard/purchasing/pr/")
  ) {
    return pathname.replace("/dashboard/purchasing/", "/dashboard/raw-material/purchasing/");
  }
  if (
    pathname === "/dashboard/purchasing/po" ||
    pathname.startsWith("/dashboard/purchasing/po/")
  ) {
    return pathname.replace("/dashboard/purchasing/", "/dashboard/raw-material/purchasing/");
  }
  return pathname;
}

export function menuHrefsMatch(a: string, b: string): boolean {
  return normalizeMenuHref(a) === normalizeMenuHref(b);
}

export function isPurchaseRequestDetailPath(pathname: string): boolean {
  const path = normalizePurchasingPathname(pathname);
  const patterns = [
    /^\/dashboard\/(?:raw-material|product)\/purchasing\/pr\/edit\/[^/]+$/,
    /^\/dashboard\/(?:raw-material|product)\/purchasing\/pr\/(?!insert$|edit$)[^/]+$/,
  ];

  return patterns.some((pattern) => pattern.test(path));
}

export function isPurchaseOrderDetailPath(pathname: string): boolean {
  const path = normalizePurchasingPathname(pathname);
  const patterns = [
    /^\/dashboard\/(?:raw-material|product)\/purchasing\/po\/edit\/[^/]+$/,
    /^\/dashboard\/(?:raw-material|product)\/purchasing\/po\/(?!insert$|edit$)[^/]+$/,
    /^\/dashboard\/(?:raw-material|product)\/purchasing\/invoice\/po\/[^/]+$/,
  ];

  return patterns.some((pattern) => pattern.test(path));
}

function resolvePurchasingNamespace(pathname: string): "raw-material" | "product" | "legacy" | null {
  const path = normalizePurchasingPathname(pathname);
  if (path.includes("/raw-material/")) return "raw-material";
  if (path.includes("/product/")) return "product";
  if (pathname.startsWith("/dashboard/purchasing/")) return "legacy";
  return null;
}

export function getApprovalPrMenuHref(pathname: string): string | null {
  const namespace = resolvePurchasingNamespace(pathname);
  if (namespace === "raw-material" || namespace === "legacy") return RM_ROUTES.approvalPr;
  if (namespace === "product") return PRODUCT_ROUTES.approvalPr;
  return null;
}

export function getPurchaseRequestListMenuHref(pathname: string): string | null {
  const namespace = resolvePurchasingNamespace(pathname);
  if (namespace === "raw-material" || namespace === "legacy") return RM_ROUTES.purchasingPr;
  if (namespace === "product") return PRODUCT_ROUTES.purchasingPr;
  return null;
}

export function getApprovalPoMenuHref(pathname: string): string | null {
  const namespace = resolvePurchasingNamespace(pathname);
  if (namespace === "raw-material" || namespace === "legacy") return RM_ROUTES.approvalPo;
  if (namespace === "product") return PRODUCT_ROUTES.approvalPo;
  return null;
}

export function getPurchaseOrderListMenuHref(pathname: string): string | null {
  const namespace = resolvePurchasingNamespace(pathname);
  if (namespace === "raw-material" || namespace === "legacy") return RM_ROUTES.purchasingPo;
  if (namespace === "product") return PRODUCT_ROUTES.purchasingPo;
  return null;
}

export function persistNavFrom(from: string): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(NAV_FROM_SESSION_KEY, from);
}

export function readPersistedNavFrom(): string | null {
  if (typeof window === "undefined") return null;
  return window.sessionStorage.getItem(NAV_FROM_SESSION_KEY);
}

export function clearPersistedNavFrom(): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(NAV_FROM_SESSION_KEY);
}

export function resolveNavFrom(pathname: string, queryFrom: string | null): string | null {
  if (queryFrom) return queryFrom;

  const persisted = readPersistedNavFrom();
  if (!persisted) return null;

  if (persisted === NAV_FROM_APPROVAL_PR && isPurchaseRequestDetailPath(pathname)) {
    return persisted;
  }

  if (persisted === NAV_FROM_APPROVAL_PO && isPurchaseOrderDetailPath(pathname)) {
    return persisted;
  }

  clearPersistedNavFrom();
  return null;
}
