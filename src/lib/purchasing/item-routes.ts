/** Canonical URL namespaces for Items → Raw Material & Product menus. */

export const RM_BASE = "/dashboard/raw-material";
export const PRODUCT_BASE = "/dashboard/product";
/**
 * EPIC-026 — scope `general` (Barang Operasional). Berbeda dari RM/Product,
 * scope ini TIDAK memakai rewrite next.config (keputusan B1, KISS): base URL =
 * lokasi fisik `/dashboard/items/general`.
 */
export const GENERAL_BASE = "/dashboard/items/general";
export const ITEMS_LANDING_PATH = "/dashboard/items";

export const RM_ROUTES = {
  units: `${RM_BASE}/units`,
  categories: `${RM_BASE}/categories`,
  materials: `${RM_BASE}/materials`,
  materialsInsert: `${RM_BASE}/materials/insert`,
  materialsImport: `${RM_BASE}/materials/import`,
  materialsDetail: (id: string) => `${RM_BASE}/materials/${id}`,
  materialsEdit: (id: string) => `${RM_BASE}/materials/edit/${id}`,
  materialsBom: (id: string) => `${RM_BASE}/materials/bom/${id}`,
  inventoryStock: `${RM_BASE}/inventory/stock`,
  inventoryOpname: `${RM_BASE}/inventory/opname`,
  inventoryOpnameInsert: `${RM_BASE}/inventory/opname/insert`,
  inventoryOpnameContinue: (id: string) => `${RM_BASE}/inventory/opname/insert?id=${id}`,
  inventoryOpnameDetail: (id: string) => `${RM_BASE}/inventory/opname/${id}`,
  inventoryAdjustment: `${RM_BASE}/inventory/adjustment`,
  inventoryTransfer: `${RM_BASE}/inventory/transfers`,
  purchasingSuppliers: `${RM_BASE}/purchasing/suppliers`,
  purchasingSuppliersInsert: `${RM_BASE}/purchasing/suppliers/insert`,
  purchasingSuppliersImport: `${RM_BASE}/purchasing/suppliers/import`,
  purchasingSuppliersDetail: (id: string) => `${RM_BASE}/purchasing/suppliers/${id}`,
  purchasingSuppliersEdit: (id: string) => `${RM_BASE}/purchasing/suppliers/edit/${id}`,
  purchasingPr: `${RM_BASE}/purchasing/pr`,
  purchasingPrInsert: `${RM_BASE}/purchasing/pr/insert`,
  purchasingPrDetail: (id: string) => `${RM_BASE}/purchasing/pr/${id}`,
  purchasingPrEdit: (id: string) => `${RM_BASE}/purchasing/pr/edit/${id}`,
  purchasingPo: `${RM_BASE}/purchasing/po`,
  purchasingPoInsert: `${RM_BASE}/purchasing/po/insert`,
  purchasingPoDetail: (id: string) => `${RM_BASE}/purchasing/po/${id}`,
  purchasingDelivery: `${RM_BASE}/purchasing/delivery`,
  purchasingGrn: `${RM_BASE}/purchasing/grn`,
  purchasingGrnInsert: `${RM_BASE}/purchasing/grn/insert`,
  purchasingGrnDetail: (id: string) => `${RM_BASE}/purchasing/grn/${id}`,
  purchasingGrnQc: (id: string) => `${RM_BASE}/purchasing/grn/${id}/qc`,
  purchasingGrnContinue: (id: string) => `${RM_BASE}/purchasing/grn/continue/${id}`,
  purchasingReturns: `${RM_BASE}/purchasing/returns`,
  purchasingReturnsInsert: `${RM_BASE}/purchasing/returns/insert`,
  purchasingReturnsDetail: (id: string) => `${RM_BASE}/purchasing/returns/${id}`,
  purchasingReturnsEdit: (id: string) => `${RM_BASE}/purchasing/returns/edit/${id}`,
  /** Account Payable (Accounting) — ex RM purchasing invoice */
  purchasingInvoice: `/dashboard/accounting/accounts-payable`,
  purchasingInvoicePoDetail: (id: string) =>
    `/dashboard/accounting/accounts-payable/po/${id}`,
  approvalPr: `${RM_BASE}/approval/pr`,
  approvalPo: `${RM_BASE}/approval/po`,
  productionRecipes: `${RM_BASE}/production/recipes`,
  productionHub: `${RM_BASE}/production`,
  productionOrder: (id: string) => `${RM_BASE}/production/orders/${id}`,
} as const;

export const PRODUCT_ROUTES = {
  categories: `${PRODUCT_BASE}/categories`,
  units: `${PRODUCT_BASE}/units`,
  products: `${PRODUCT_BASE}/products`,
  productsInsert: `${PRODUCT_BASE}/products/insert`,
  productsDetail: (id: string) => `${PRODUCT_BASE}/products/${id}`,
  productsEdit: (id: string) => `${PRODUCT_BASE}/products/edit/${id}`,
  productsBom: (id: string) => `${PRODUCT_BASE}/products/bom/${id}`,
  productsImport: `${PRODUCT_BASE}/products/import`,
  inventoryStock: `${PRODUCT_BASE}/inventory/stock`,
  inventoryOpname: `${PRODUCT_BASE}/inventory/opname`,
  inventoryOpnameInsert: `${PRODUCT_BASE}/inventory/opname/insert`,
  inventoryOpnameContinue: (id: string) => `${PRODUCT_BASE}/inventory/opname/insert?id=${id}`,
  inventoryOpnameDetail: (id: string) => `${PRODUCT_BASE}/inventory/opname/${id}`,
  inventoryAdjustment: `${PRODUCT_BASE}/inventory/adjustment`,
  inventoryTransfer: `${PRODUCT_BASE}/inventory/transfer`,
  purchasingVendor: `${PRODUCT_BASE}/purchasing/vendor`,
  purchasingVendorInsert: `${PRODUCT_BASE}/purchasing/vendor/insert`,
  purchasingVendorDetail: (id: string) => `${PRODUCT_BASE}/purchasing/vendor/${id}`,
  purchasingVendorEdit: (id: string) => `${PRODUCT_BASE}/purchasing/vendor/edit/${id}`,
  purchasingPriceList: `${PRODUCT_BASE}/purchasing/price-list`,
  purchasingPriceListInsert: `${PRODUCT_BASE}/purchasing/price-list/insert`,
  purchasingPriceListDetail: (id: string) => `${PRODUCT_BASE}/purchasing/price-list/${id}`,
  purchasingPriceListEdit: (id: string) => `${PRODUCT_BASE}/purchasing/price-list/edit/${id}`,
  purchasingPr: `${PRODUCT_BASE}/purchasing/pr`,
  purchasingPrInsert: `${PRODUCT_BASE}/purchasing/pr/insert`,
  purchasingPrDetail: (id: string) => `${PRODUCT_BASE}/purchasing/pr/${id}`,
  purchasingPrEdit: (id: string) => `${PRODUCT_BASE}/purchasing/pr/edit/${id}`,
  purchasingPo: `${PRODUCT_BASE}/purchasing/po`,
  purchasingPoInsert: `${PRODUCT_BASE}/purchasing/po/insert`,
  purchasingPoDetail: (id: string) => `${PRODUCT_BASE}/purchasing/po/${id}`,
  purchasingDelivery: `${PRODUCT_BASE}/purchasing/delivery`,
  purchasingDeliveryInsert: `${PRODUCT_BASE}/purchasing/delivery/insert`,
  purchasingDeliveryDetail: (id: string) => `${PRODUCT_BASE}/purchasing/delivery/${id}`,
  purchasingReceive: `${PRODUCT_BASE}/purchasing/receive`,
  purchasingReceiveInsert: `${PRODUCT_BASE}/purchasing/receive/insert`,
  purchasingReceiveDetail: (id: string) => `${PRODUCT_BASE}/purchasing/receive/${id}`,
  purchasingReceiveContinue: (id: string) => `${PRODUCT_BASE}/purchasing/receive/continue/${id}`,
  purchasingReceiveQc: (id: string) => `${PRODUCT_BASE}/purchasing/receive/${id}/qc`,
  purchasingReturns: `${PRODUCT_BASE}/purchasing/returns`,
  purchasingReturnsInsert: `${PRODUCT_BASE}/purchasing/returns/insert`,
  purchasingReturnsDetail: (id: string) => `${PRODUCT_BASE}/purchasing/returns/${id}`,
  purchasingReturnsEdit: (id: string) => `${PRODUCT_BASE}/purchasing/returns/edit/${id}`,
  purchasingInvoice: `${PRODUCT_BASE}/purchasing/invoice`,
  purchasingInvoicePoDetail: (id: string) => `${PRODUCT_BASE}/purchasing/invoice/po/${id}`,
  approvalPr: `${PRODUCT_BASE}/approval/pr`,
  approvalPo: `${PRODUCT_BASE}/approval/po`,
  productionRecipes: `${PRODUCT_BASE}/production/recipes`,
  productionHub: `${PRODUCT_BASE}/production`,
  productionOrder: (id: string) => `${PRODUCT_BASE}/production/orders/${id}`,
} as const;

/**
 * EPIC-026 B2 — rute scope `general` (Barang Operasional). Subset dari pipeline
 * penuh: master + PR. Rute PO/approval sudah didefinisikan agar detail PR bisa
 * merujuknya (halaman fisik menyusul di B3/B5).
 */
export const GENERAL_ROUTES = {
  items: `${GENERAL_BASE}/items`,
  categories: `${GENERAL_BASE}/categories`,
  purchasingPr: `${GENERAL_BASE}/purchasing/pr`,
  purchasingPrInsert: `${GENERAL_BASE}/purchasing/pr/insert`,
  purchasingPrDetail: (id: string) => `${GENERAL_BASE}/purchasing/pr/${id}`,
  purchasingPrEdit: (id: string) => `${GENERAL_BASE}/purchasing/pr/edit/${id}`,
  purchasingPo: `${GENERAL_BASE}/purchasing/po`,
  purchasingPoInsert: `${GENERAL_BASE}/purchasing/po/insert`,
  purchasingPoDetail: (id: string) => `${GENERAL_BASE}/purchasing/po/${id}`,
  // B4 — Penerimaan barang operasional (tanpa langkah delivery manual).
  purchasingReceive: `${GENERAL_BASE}/purchasing/receive`,
  purchasingReceiveForm: (poId: string) => `${GENERAL_BASE}/purchasing/receive/${poId}`,
  approvalPr: `${GENERAL_BASE}/approval/pr`,
  approvalPo: `${GENERAL_BASE}/approval/po`,
  // B5 — Invoice/pembayaran vendor barang operasional. Detail invoice me-reuse
  // halaman general PO detail (seperti product) → tanpa route fisik terpisah.
  purchasingInvoice: `${GENERAL_BASE}/purchasing/invoice`,
  purchasingInvoicePoDetail: (id: string) => `${GENERAL_BASE}/purchasing/po/${id}`,
  // C1–C2 — Inventory riil barang operasional.
  inventory: `${GENERAL_BASE}/inventory`,
  inventoryDetail: (id: string) => `${GENERAL_BASE}/inventory/${id}`,
  inventoryUsage: `${GENERAL_BASE}/inventory/usage`,
  inventoryAdjustment: `${GENERAL_BASE}/inventory/adjustment`,
} as const;

/** @deprecated Use RM_ROUTES.materials */
export const ITEMS_RAW_MATERIALS_PATH = RM_ROUTES.materials;

/** @deprecated Use PRODUCT_ROUTES.products */
export const ITEMS_PRODUCTS_PATH = PRODUCT_ROUTES.products;

/** @deprecated Use PRODUCT_ROUTES.categories */
export const ITEMS_PRODUCT_CATEGORIES_PATH = PRODUCT_ROUTES.categories;
