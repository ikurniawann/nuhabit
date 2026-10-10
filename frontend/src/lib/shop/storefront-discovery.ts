// Storefront browsing: pure rules (no I/O) for the promo, new and featured
// sections, the size and price filters in the URL, and related products.

import { filterAndSortProducts, productStartingPrice, type CatalogSort } from "./storefront-cart";
import type { CatalogProduct } from "./types";

export type CatalogSection = { id: "promo" | "new" | "featured"; name: string; products: CatalogProduct[] };

/** Sale, new and featured rows, in that order; empty sections are left out. */
export function catalogSections(products: CatalogProduct[]): CatalogSection[] {
  const sections: CatalogSection[] = [
    { id: "promo", name: "Promo", products: products.filter((product) => (product.salePercent ?? 0) > 0) },
    { id: "new", name: "New arrivals", products: products.filter((product) => product.isNew) },
    { id: "featured", name: "Featured", products: products.filter((product) => product.isFeatured) },
  ];
  return sections.filter((section) => section.products.length > 0);
}

/** Products the catalog names as related, in the catalog's order, that still exist. */
export function relatedProducts(product: CatalogProduct, products: CatalogProduct[]): CatalogProduct[] {
  const byId = new Map(products.map((item) => [item.id, item]));
  return product.relatedIds
    .map((id) => byId.get(id))
    .filter((item): item is CatalogProduct => item !== undefined && item.id !== product.id)
    .slice(0, 4);
}

/** Products for a list of ids (saved, recently viewed), keeping the list order. */
export function productsByIds(ids: string[], products: CatalogProduct[]): CatalogProduct[] {
  const byId = new Map(products.map((item) => [item.id, item]));
  return ids.map((id) => byId.get(id)).filter((item): item is CatalogProduct => item !== undefined);
}

export type CatalogFilters = {
  search: string;
  sort: CatalogSort;
  availableOnly: boolean;
  /** Size names (SKU names) the product must offer; empty means any. */
  sizes: string[];
  priceMin: number | null;
  priceMax: number | null;
};

export const EMPTY_FILTERS: CatalogFilters = {
  search: "",
  sort: "featured",
  availableOnly: false,
  sizes: [],
  priceMin: null,
  priceMax: null,
};

const SORTS: CatalogSort[] = ["featured", "price-asc", "price-desc", "name"];

const positiveInt = (raw: string | null): number | null => {
  if (raw === null || raw.trim() === "") return null;
  const n = Math.floor(Number(raw));
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** Filters from the page query: q, sort, available, size (comma list), min, max. */
export function parseCatalogFilters(query: URLSearchParams): CatalogFilters {
  const sort = query.get("sort") as CatalogSort | null;
  return {
    search: query.get("q") ?? "",
    sort: sort && SORTS.includes(sort) ? sort : "featured",
    availableOnly: query.get("available") === "1",
    sizes: (query.get("size") ?? "").split(",").map((size) => size.trim()).filter(Boolean),
    priceMin: positiveInt(query.get("min")),
    priceMax: positiveInt(query.get("max")),
  };
}

/** The page query for these filters; defaults are left out so the URL stays short. */
export function catalogFiltersQuery(filters: CatalogFilters): string {
  const query = new URLSearchParams();
  if (filters.search.trim()) query.set("q", filters.search.trim());
  if (filters.sort !== "featured") query.set("sort", filters.sort);
  if (filters.availableOnly) query.set("available", "1");
  if (filters.sizes.length > 0) query.set("size", filters.sizes.join(","));
  if (filters.priceMin !== null) query.set("min", String(filters.priceMin));
  if (filters.priceMax !== null) query.set("max", String(filters.priceMax));
  return query.toString();
}

/** The default browse view: sections and collections instead of a flat result list. */
export function isBrowsing(filters: CatalogFilters): boolean {
  return catalogFiltersQuery(filters) === "";
}

/** Size names offered across the catalog, in first-seen order. */
export function catalogSizes(products: CatalogProduct[]): string[] {
  const seen = new Set<string>();
  for (const product of products) for (const sku of product.skus) seen.add(sku.name);
  return [...seen];
}

export function applyCatalogFilters(products: CatalogProduct[], filters: CatalogFilters): CatalogProduct[] {
  const found = filterAndSortProducts(products, filters.search, filters.availableOnly, filters.sort);
  return found.filter((product) => {
    if (filters.sizes.length > 0 && !product.skus.some((sku) => filters.sizes.includes(sku.name))) return false;
    const price = productStartingPrice(product);
    if (filters.priceMin !== null && price < filters.priceMin) return false;
    if (filters.priceMax !== null && price > filters.priceMax) return false;
    return true;
  });
}

/** Sale copy for the badge and the sheet; null when the product is not on sale. */
export function saleEndsText(product: Pick<CatalogProduct, "salePercent" | "saleUntil">, formatDate: (value: string) => string): string | null {
  if (!product.salePercent) return null;
  return product.saleUntil ? `Sale ends ${formatDate(product.saleUntil)}` : "On sale";
}
