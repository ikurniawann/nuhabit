// Public storefront types shared by the server (lib) and the client (features).

export type CatalogSku = {
  id: string;
  sku: string;
  name: string;
  /** Effective price: the sale price while the sale runs. */
  price: number;
  /** The regular price while a sale applies, else null. */
  compareAtPrice: number | null;
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
  /** Effective price: the sale price while the sale runs. */
  price: number;
  /** The regular price while a sale applies, else null. */
  compareAtPrice: number | null;
  /** Whole-number discount while a sale applies, else null. */
  salePercent: number | null;
  /** Sale end (ISO timestamp) or null for an open-ended sale. */
  saleUntil: string | null;
  isFeatured: boolean;
  isNew: boolean;
  /** Stock at or under the storefront low-stock threshold. */
  lowStock: boolean;
  /** Restocked from 0 within the last 7 days. */
  backInStock: boolean;
  rating: ProductRating | null;
  /** Up to 4 product ids from the same collection, in stock first. */
  relatedIds: string[];
  weightGram: number | null;
  stock: number;
  collection: CatalogCollection | null;
  /** Pre-order deadline (YYYY-MM-DD) or null. */
  preorderUntil: string | null;
  /** The product (or one of its variants) sells as a pre-order. */
  preorder: boolean;
  skus: CatalogSku[];
};

export type ProductRating = { average: number; count: number };

/** A published review on the product sheet. */
export type ProductReview = {
  id: string;
  rating: number;
  comment: string;
  customerName: string | null;
  createdAt: string;
};

/** Campaign banner on the storefront page; the code pre-fills checkout. */
export type StorefrontBanner = { headline: string; text: string; code: string | null };

/** Storefront settings the dashboard edits and the catalog exposes. */
export type StorefrontSettings = {
  pickupEnabled: boolean;
  freeShippingThreshold: number | null;
  lowStockThreshold: number;
  whatsappNumber: string | null;
  bannerHeadline: string | null;
  bannerText: string | null;
  bannerCode: string | null;
};

export const DEFAULT_STOREFRONT_SETTINGS: StorefrontSettings = {
  pickupEnabled: false,
  freeShippingThreshold: null,
  lowStockThreshold: 3,
  whatsappNumber: null,
  bannerHeadline: null,
  bannerText: null,
  bannerCode: null,
};

export type PickupBranch = { id: string; name: string; address: string; city: string; phone: string };

export type PublicStorefront = {
  slug: string;
  name: string;
  description: string | null;
  settings: StorefrontSettings;
  pickupBranches: PickupBranch[];
  banner: StorefrontBanner | null;
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

export type PublicOrderItem = {
  productId: string | null;
  name: string;
  quantity: number;
  unit_price: number;
  total: number;
  /** A signed-in member may review this product: the order is paid and no review exists yet. */
  reviewable: boolean;
};

export type PublicOrderStatus = {
  /** Store the order belongs to; reviews post to its public routes. */
  storefrontSlug: string;
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
  items: PublicOrderItem[];
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
