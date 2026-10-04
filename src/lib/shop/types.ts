// Tipe storefront publik yang dipakai server (lib) dan klien (features).

export type CatalogSku = {
  id: string;
  sku: string;
  name: string;
  price: number;
  stock: number;
};

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
  skus: CatalogSku[];
};

export type PublicStorefront = { slug: string; name: string; description: string | null };

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
