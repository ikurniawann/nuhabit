// ============================================================
// Purchasing Route Configuration
//
// Defines all purchasing module routes with metadata.
// Consumed by: sidebar, breadcrumbs, protected routes, route guards.
// ============================================================

import { PRODUCT_ROUTES, RM_ROUTES } from "../constants/item-routes";
import { ALLOWED_PURCHASING_ROLES, PurchasingRole } from "../constants";

export interface RouteMeta {
  /** Public label shown in sidebar & breadcrumbs */
  label: string;
  /** Heroicons outline icon name (auto-imported via @heroicons/react/24/outline) */
  icon: string;
  /** Roles allowed to access this route (null = authenticated + allowed_purchasing_roles) */
  allowedRoles?: PurchasingRole[];
  /** If true, only purchasing_admin can access */
  adminOnly?: boolean;
  /** If true, redirect to list instead of showing "no access" */
  softRedirect?: boolean;
}

export type PurchasingRoute =
  // ── Suppliers ──────────────────────────────────────────────
  | "suppliers.list"
  | "suppliers.new"
  | "suppliers.edit"
  | "suppliers.detail"
  // ── Raw Materials ──────────────────────────────────────────
  | "raw-materials.list"
  | "raw-materials.new"
  | "raw-materials.edit"
  | "raw-materials.detail"
  // ── Products (BOM) ─────────────────────────────────────────
  | "products.list"
  | "products.new"
  | "products.edit"
  | "products.detail"
  | "products.bom"
  // ── Purchase Orders ────────────────────────────────────────
  | "purchase-orders.list"
  | "purchase-orders.new"
  | "purchase-orders.edit"
  | "purchase-orders.detail"
  | "purchase-orders.approval"
  // ── Delivery ───────────────────────────────────────────────
  | "delivery.list"
  | "delivery.detail"
  // ── Receiving (GRN) ─────────────────────────────────────────
  | "receiving.list"
  | "receiving.grn-new"
  | "receiving.grn-detail"
  // ── QC ─────────────────────────────────────────────────────
  | "qc.list"
  | "qc.detail"
  // ── Returns ────────────────────────────────────────────────
  | "returns.list"
  | "returns.new"
  | "returns.detail"
  // ── Inventory ───────────────────────────────────────────────
  | "inventory.list"
  | "inventory.movements"
  | "inventory.adjustment"
  // ── Reports ────────────────────────────────────────────────
  | "reports.stock-card"
  | "reports.inventory-valuation"
  | "reports.po-summary"
  | "reports.po-detail"
  | "reports.supplier-performance"
  | "reports.production-in-house"
  | "reports.hpp-breakdown";

export interface RouteDefinition {
  route: PurchasingRoute;
  path: string;
  meta: RouteMeta;
}

// ── Route definitions ─────────────────────────────────────

export const ROUTES: RouteDefinition[] = [
  // ── Suppliers ─────────────────────────────────────────────
  {
    route: "suppliers.list",
    path: "/dashboard/purchasing/suppliers",
    meta: { label: "Supplier", icon: "BuildingOfficeIcon" },
  },
  {
    route: "suppliers.new",
    path: "/dashboard/purchasing/suppliers/insert",
    meta: { label: "Tambah Supplier", icon: "BuildingOfficeIcon" },
  },
  {
    route: "suppliers.edit",
    path: "/dashboard/purchasing/suppliers/edit/[id]",
    meta: { label: "Edit Supplier", icon: "BuildingOfficeIcon" },
  },
  {
    route: "suppliers.detail",
    path: "/dashboard/purchasing/suppliers/[id]",
    meta: { label: "Detail Supplier", icon: "BuildingOfficeIcon" },
  },

  // ── Raw Materials ─────────────────────────────────────────
  {
    route: "raw-materials.list",
    path: RM_ROUTES.materials,
    meta: { label: "Bahan Baku", icon: "CubeIcon" },
  },
  {
    route: "raw-materials.new",
    path: RM_ROUTES.materialsInsert,
    meta: { label: "Tambah Bahan", icon: "CubeIcon" },
  },
  {
    route: "raw-materials.edit",
    path: "/dashboard/raw-material/materials/edit/[id]",
    meta: { label: "Edit Bahan", icon: "CubeIcon" },
  },
  {
    route: "raw-materials.detail",
    path: "/dashboard/raw-material/materials/[id]",
    meta: { label: "Detail Bahan", icon: "CubeIcon" },
  },

  // ── Products ──────────────────────────────────────────────
  {
    route: "products.list",
    path: PRODUCT_ROUTES.products,
    meta: { label: "Produk", icon: "CubeTransparentIcon" },
  },
  {
    route: "products.new",
    path: PRODUCT_ROUTES.productsInsert,
    meta: { label: "Tambah Produk", icon: "CubeTransparentIcon" },
  },
  {
    route: "products.edit",
    path: "/dashboard/product/products/edit/[id]",
    meta: { label: "Edit Produk", icon: "CubeTransparentIcon" },
  },
  {
    route: "products.detail",
    path: "/dashboard/product/products/[id]",
    meta: { label: "Detail Produk", icon: "CubeTransparentIcon" },
  },
  {
    route: "products.bom",
    path: "/dashboard/product/products/bom/[id]",
    meta: { label: "Editor Resep (BOM)", icon: "CubeTransparentIcon" },
  },

  // ── Purchase Orders ────────────────────────────────────────
  {
    route: "purchase-orders.list",
    path: "/dashboard/purchasing/po",
    meta: { label: "Purchase Order", icon: "ClipboardDocumentListIcon" },
  },
  {
    route: "purchase-orders.new",
    path: "/dashboard/purchasing/po/insert",
    meta: { label: "Buat PO", icon: "ClipboardDocumentListIcon" },
  },
  {
    route: "purchase-orders.edit",
    path: "/dashboard/purchasing/po/edit/[id]",
    meta: { label: "Edit PO", icon: "ClipboardDocumentListIcon" },
  },
  {
    route: "purchase-orders.detail",
    path: "/dashboard/purchasing/po/[id]",
    meta: { label: "Detail PO", icon: "ClipboardDocumentListIcon" },
  },
  {
    route: "purchase-orders.approval",
    path: "/dashboard/purchasing/approval/po",
    meta: { label: "Approval PO", icon: "ClipboardDocumentCheckIcon", allowedRoles: ["purchasing_manager", "direksi"] },
  },

  // ── Delivery ──────────────────────────────────────────────
  {
    route: "delivery.list",
    path: "/dashboard/purchasing/delivery",
    meta: { label: "Delivery", icon: "TruckIcon" },
  },
  {
    route: "delivery.detail",
    path: "/dashboard/purchasing/delivery/[id]",
    meta: { label: "Delivery Detail", icon: "TruckIcon" },
  },

  // ── Receiving / GRN ────────────────────────────────────────
  {
    route: "receiving.list",
    path: "/dashboard/purchasing/grn",
    meta: { label: "Goods Receipt", icon: "ArrowDownCircleIcon" },
  },
  {
    route: "receiving.grn-new",
    path: "/dashboard/purchasing/grn/insert",
    meta: { label: "Record Goods Receipt", icon: "ArrowDownCircleIcon" },
  },
  {
    route: "receiving.grn-detail",
    path: "/dashboard/purchasing/grn/[id]",
    meta: { label: "Goods Receipt Detail", icon: "ArrowDownCircleIcon" },
  },

  // ── QC ────────────────────────────────────────────────────
  {
    route: "qc.list",
    path: "/dashboard/purchasing/qc",
    meta: { label: "Quality Control", icon: "CheckBadgeIcon" },
  },
  {
    route: "qc.detail",
    path: "/dashboard/purchasing/qc/[id]",
    meta: { label: "Detail QC", icon: "CheckBadgeIcon" },
  },

  // ── Returns ────────────────────────────────────────────────
  {
    route: "returns.list",
    path: "/dashboard/purchasing/returns",
    meta: { label: "Retur", icon: "ArrowUturnLeftIcon" },
  },
  {
    route: "returns.new",
    path: "/dashboard/purchasing/returns/insert",
    meta: { label: "Buat Retur", icon: "ArrowUturnLeftIcon" },
  },
  {
    route: "returns.detail",
    path: "/dashboard/purchasing/returns/[id]",
    meta: { label: "Detail Retur", icon: "ArrowUturnLeftIcon" },
  },

  // ── Inventory ─────────────────────────────────────────────
  {
    route: "inventory.list",
    path: "/dashboard/purchasing/inventory",
    meta: { label: "Inventori", icon: "ArchiveBoxIcon" },
  },
  {
    route: "inventory.movements",
    path: "/dashboard/purchasing/inventory/[bahanId]/movements",
    meta: { label: "Mutasi Stok", icon: "ArrowsRightLeftIcon" },
  },
  {
    route: "inventory.adjustment",
    path: "/dashboard/purchasing/inventory/adjustment",
    meta: { label: "Koreksi Stok", icon: "PencilSquareIcon", adminOnly: true },
  },

  // ── Reports ────────────────────────────────────────────────
  {
    route: "reports.stock-card",
    path: "/dashboard/purchasing/reports/stock-card",
    meta: { label: "Stock Card", icon: "ClipboardDocumentListIcon" },
  },
  {
    route: "reports.inventory-valuation",
    path: "/dashboard/purchasing/reports/inventory-valuation",
    meta: { label: "Inventory Valuation", icon: "ChartBarIcon" },
  },
  {
    route: "reports.po-summary",
    path: "/dashboard/purchasing/reports/po-summary",
    meta: { label: "PO Summary", icon: "DocumentChartBarIcon" },
  },
  {
    route: "reports.po-detail",
    path: "/dashboard/purchasing/reports/po-detail",
    meta: { label: "PO Detail", icon: "DocumentTextIcon" },
  },
  {
    route: "reports.supplier-performance",
    path: "/dashboard/purchasing/reports/supplier-performance",
    meta: { label: "Supplier Performance", icon: "UserGroupIcon" },
  },
  {
    route: "reports.production-in-house",
    path: "/dashboard/purchasing/reports/production-in-house",
    meta: { label: "Produksi Internal", icon: "CubeIcon" },
  },
  {
    route: "reports.hpp-breakdown",
    path: "/dashboard/purchasing/reports/hpp-breakdown",
    meta: { label: "HPP Produk", icon: "CalculatorIcon" },
  },
];

// ── Lookup helpers ────────────────────────────────────────

export const ROUTE_MAP = ROUTES.reduce<Record<PurchasingRoute, RouteDefinition>>(
  (acc, def) => {
    acc[def.route] = def;
    return acc;
  },
  {} as Record<PurchasingRoute, RouteDefinition>
);

export const PATH_TO_ROUTE = ROUTES.reduce<Record<string, PurchasingRoute>>(
  (acc, def) => {
    acc[def.path] = def.route;
    return acc;
  },
  {} as Record<string, PurchasingRoute>
);

/**
 * Resolve a route + params → full URL string.
 * Replaces [param] segments.
 */
export function resolvePath(route: PurchasingRoute, params?: Record<string, string | number>): string {
  let path = ROUTE_MAP[route]?.path ?? route;
  if (params) {
    Object.entries(params).forEach(([key, val]) => {
      path = path.replace(`[${key}]`, String(val));
    });
  }
  return path;
}

/**
 * Get the parent section for grouping in sidebar / breadcrumbs.
 * Returns the section label.
 */
export function getSectionLabel(route: PurchasingRoute): string {
  if (route.startsWith("suppliers")) return "Master";
  if (route.startsWith("raw-materials")) return "Master";
  if (route.startsWith("products")) return "Master";
  if (route.startsWith("purchase-orders")) return "Transaksi";
  if (route.startsWith("delivery")) return "Transaksi";
  if (route.startsWith("receiving")) return "Transaksi";
  if (route.startsWith("qc")) return "Transaksi";
  if (route.startsWith("returns")) return "Transaksi";
  if (route.startsWith("inventory")) return "Inventori";
  if (route.startsWith("reports")) return "Reports";
  return "Purchasing";
}

/**
 * Routes that appear as sidebar section headers (not clickable).
 */
export const SIDEBAR_SECTIONS: { label: string; routes: PurchasingRoute[] }[] = [
  {
    label: "Master",
    routes: ["suppliers.list", "raw-materials.list", "products.list"],
  },
  {
    label: "Transaksi",
    routes: ["purchase-orders.list", "delivery.list", "receiving.list", "qc.list", "returns.list"],
  },
  {
    label: "Inventori",
    routes: ["inventory.list", "inventory.adjustment"],
  },
  {
    label: "Reports",
    routes: ["reports.stock-card", "reports.inventory-valuation", "reports.po-summary", "reports.po-detail", "reports.supplier-performance", "reports.production-in-house", "reports.hpp-breakdown"],
  },
];
