import { PRODUCT_ROUTES, RM_ROUTES } from "@/lib/purchasing/item-routes";

export interface ItemsNavLink {
  href: string;
  label: string;
}

export interface ItemsNavGroup {
  label: string;
  items: readonly ItemsNavLink[];
}

export const RAW_MATERIAL_NAV_GROUPS: readonly ItemsNavGroup[] = [
  {
    label: "Data Master",
    items: [
      { href: RM_ROUTES.units, label: "Satuan" },
      { href: RM_ROUTES.categories, label: "Kategori" },
      { href: RM_ROUTES.materials, label: "Bahan Baku" },
    ],
  },
  {
    label: "Persediaan",
    items: [
      { href: RM_ROUTES.inventoryStock, label: "Stok" },
      { href: RM_ROUTES.inventoryOpname, label: "Stok Opname" },
      { href: RM_ROUTES.inventoryAdjustment, label: "Penyesuaian Stok" },
      { href: RM_ROUTES.inventoryTransfer, label: "Transfer Stok" },
    ],
  },
  {
    label: "Pembelian",
    items: [
      { href: RM_ROUTES.purchasingSuppliers, label: "Supplier" },
      { href: RM_ROUTES.purchasingPr, label: "Purchase Request" },
      { href: RM_ROUTES.purchasingPo, label: "Purchase Order" },
      { href: RM_ROUTES.purchasingDelivery, label: "Lacak Pengiriman" },
      { href: RM_ROUTES.purchasingGrn, label: "Penerimaan (GRN)" },
      { href: RM_ROUTES.purchasingReturns, label: "Retur" },
    ],
  },
  {
    label: "Persetujuan",
    items: [
      { href: RM_ROUTES.approvalPr, label: "Persetujuan PR" },
      { href: RM_ROUTES.approvalPo, label: "Persetujuan PO" },
    ],
  },
  {
    label: "Produksi",
    items: [
      { href: RM_ROUTES.productionRecipes, label: "Resep (BOM)" },
      { href: RM_ROUTES.productionHub, label: "Produksi Internal" },
    ],
  },
] as const;

export const PRODUCT_NAV_GROUPS: readonly ItemsNavGroup[] = [
  {
    label: "Data Master",
    items: [
      { href: PRODUCT_ROUTES.units, label: "Satuan" },
      { href: PRODUCT_ROUTES.categories, label: "Kategori" },
      { href: PRODUCT_ROUTES.products, label: "Produk" },
    ],
  },
  {
    label: "Persediaan",
    items: [
      { href: PRODUCT_ROUTES.inventoryStock, label: "Stok" },
      { href: PRODUCT_ROUTES.inventoryOpname, label: "Stok Opname" },
      { href: PRODUCT_ROUTES.inventoryAdjustment, label: "Penyesuaian Stok" },
      { href: PRODUCT_ROUTES.inventoryTransfer, label: "Transfer Stok" },
    ],
  },
  {
    label: "Pembelian",
    items: [
      { href: PRODUCT_ROUTES.purchasingVendor, label: "Vendor" },
      { href: PRODUCT_ROUTES.purchasingPr, label: "Purchase Request" },
      { href: PRODUCT_ROUTES.purchasingPo, label: "Purchase Order" },
      { href: PRODUCT_ROUTES.purchasingDelivery, label: "Lacak Pengiriman" },
      { href: PRODUCT_ROUTES.purchasingReceive, label: "Penerimaan (GRN)" },
      { href: PRODUCT_ROUTES.purchasingReturns, label: "Retur" },
      { href: PRODUCT_ROUTES.purchasingInvoice, label: "Invoice" },
    ],
  },
  {
    label: "Persetujuan",
    items: [
      { href: PRODUCT_ROUTES.approvalPr, label: "Persetujuan PR" },
      { href: PRODUCT_ROUTES.approvalPo, label: "Persetujuan PO" },
    ],
  },
  {
    label: "Produksi",
    items: [
      { href: PRODUCT_ROUTES.productionRecipes, label: "Resep (BOM)" },
      { href: PRODUCT_ROUTES.productionHub, label: "Produksi Internal" },
    ],
  },
] as const;
