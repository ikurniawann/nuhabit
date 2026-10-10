// Catalog fixtures for storefront tests.

import type { CatalogProduct, CatalogSku } from "@/lib/shop/types";

export const catalogSku = (over: Partial<CatalogSku> & Pick<CatalogSku, "id" | "name">): CatalogSku => ({
  sku: over.id,
  price: 100_000,
  compareAtPrice: null,
  stock: 5,
  preorder: false,
  ...over,
});

export const catalogProduct = (over: Partial<CatalogProduct> & Pick<CatalogProduct, "id">): CatalogProduct => ({
  name: over.id,
  description: null,
  longDescription: null,
  imageUrl: null,
  images: [],
  price: 100_000,
  compareAtPrice: null,
  salePercent: null,
  saleUntil: null,
  isFeatured: false,
  isNew: false,
  lowStock: false,
  backInStock: false,
  rating: null,
  relatedIds: [],
  weightGram: null,
  stock: 5,
  collection: null,
  preorderUntil: null,
  preorder: false,
  skus: [],
  ...over,
});
