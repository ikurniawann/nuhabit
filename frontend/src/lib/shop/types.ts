// Public storefront types shared by the server (lib) and the client (features).

export type CatalogSku = {
  id: string;
  sku: string;
  name: string;
  price: number;
  stock: number;
  /** Stock 0 but the product's pre-order window is still open. */
  preorder: boolean;
};

/** A storefront collection is a POS product category. */
export type CatalogCollection = { id: string; name: string };

export type CatalogProduct = {
  id: string;
  name: string;
  description: string | null;
  longDescription: string | null;
  sizeGuide?: string | null;
  imageUrl: string | null;
  images: string[];
  price: number;
  weightGram: number | null;
  stock: number;
  collection: CatalogCollection | null;
  /** Pre-order deadline (YYYY-MM-DD) or null. */
  preorderUntil: string | null;
  /** The product (or one of its variants) sells as a pre-order. */
  preorder: boolean;
  skus: CatalogSku[];
};

/** Storefront settings the dashboard edits and the catalog exposes. */
export type StorefrontSettings = {
  pickupEnabled: boolean;
  freeShippingThreshold: number | null;
  lowStockThreshold: number;
  whatsappNumber: string | null;
};

export const DEFAULT_STOREFRONT_SETTINGS: StorefrontSettings = {
  pickupEnabled: false,
  freeShippingThreshold: null,
  lowStockThreshold: 3,
  whatsappNumber: null,
};

export type PickupBranch = { id: string; name: string; address: string; city: string; phone: string };

export type PublicStorefront = {
  slug: string;
  name: string;
  description: string | null;
  settings: StorefrontSettings;
  pickupBranches: PickupBranch[];
};

export type PublicCatalog = {
  storefront: PublicStorefront;
  collections: CatalogCollection[];
  products: CatalogProduct[];
};

export type DeliveryMethod = "ship" | "pickup";
export type PaymentMethod = "xendit" | "arkcoin";

/** A promo code the storefront accepted for the current cart. */
export type AppliedPromo = { code: string; discountAmount: number; label: string };

/** GET /api/public/shop/{slug}/me with a member session; null for guests. */
export type ShopMember = {
  name: string;
  phone: string;
  email: string | null;
  arkBalance: number;
  lastAddress: { address: string; areaId: string; areaLabel: string; postalCode: string | null } | null;
};

export type PublicOrderStatus = {
  order_number: string;
  status: string;
  customer_name: string;
  shipping_area_label: string | null;
  shipping_address: string;
  courier: string;
  subtotal: number;
  shipping_cost: number;
  total: number;
  invoice_url: string | null;
  waybill: string | null;
  paid_at: string | null;
  created_at: string;
  items: Array<{ name: string; quantity: number; unit_price: number; total: number }>;
  delivery: {
    method: DeliveryMethod;
    branch: { name: string; address: string; phone: string } | null;
    readyAt: string | null;
  };
  discountAmount: number;
  promoCode: string | null;
  paymentMethod: PaymentMethod;
  etaText: string | null;
  whatsappUrl: string | null;
};
