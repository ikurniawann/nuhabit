// Tipe storefront publik yang dipakai server (lib) dan klien (features).

export type CatalogSku = {
  id: string;
  sku: string;
  name: string;
  price: number;
  stock: number;
  /** Stok 0 tetapi masa pre-order produk masih terbuka. */
  preorder: boolean;
};

/** Koleksi storefront = kategori produk POS. */
export type CatalogCollection = { id: string; name: string };

export type CatalogProduct = {
  id: string;
  name: string;
  description: string | null;
  longDescription: string | null;
  imageUrl: string | null;
  images: string[];
  price: number;
  weightGram: number | null;
  stock: number;
  collection: CatalogCollection | null;
  /** Batas pre-order (YYYY-MM-DD) atau null. */
  preorderUntil: string | null;
  /** Produk (atau salah satu variannya) dijual sebagai pre-order. */
  preorder: boolean;
  skus: CatalogSku[];
};

export type PublicStorefront = { slug: string; name: string; description: string | null };

export type PublicCatalog = {
  storefront: PublicStorefront;
  collections: CatalogCollection[];
  products: CatalogProduct[];
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
};
