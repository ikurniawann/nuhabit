import { describe, expect, it } from "vitest";
import { catalogProduct, catalogSku } from "@/test/shop-fixtures";
import {
  applyCatalogFilters,
  catalogFiltersQuery,
  catalogSections,
  catalogSizes,
  EMPTY_FILTERS,
  isBrowsing,
  parseCatalogFilters,
  productsByIds,
  relatedProducts,
  saleEndsText,
} from "./storefront-discovery";

const sale = catalogProduct({ id: "sale", name: "Sale Tee", price: 80_000, compareAtPrice: 100_000, salePercent: 20, saleUntil: "2026-10-20T16:59:59Z" });
const fresh = catalogProduct({ id: "fresh", name: "New Cap", isNew: true, price: 50_000 });
const star = catalogProduct({ id: "star", name: "Featured Hoodie", isFeatured: true, isNew: true, price: 300_000 });
const shirt = catalogProduct({
  id: "shirt",
  name: "Training Shirt",
  price: 150_000,
  skus: [catalogSku({ id: "s", name: "S", price: 150_000, stock: 0 }), catalogSku({ id: "m", name: "M", price: 160_000, stock: 2 })],
  relatedIds: ["sale", "missing", "shirt", "fresh"],
});
const products = [sale, fresh, star, shirt];

describe("catalogSections", () => {
  it("derives Promo, New arrivals and Featured in that order and drops empty sections", () => {
    expect(catalogSections(products).map((section) => [section.name, section.products.map((p) => p.id)])).toEqual([
      ["Promo", ["sale"]],
      ["New arrivals", ["fresh", "star"]],
      ["Featured", ["star"]],
    ]);
    expect(catalogSections([shirt])).toEqual([]);
  });
});

describe("relatedProducts and productsByIds", () => {
  it("keeps the catalog order, skips unknown ids and the product itself", () => {
    expect(relatedProducts(shirt, products).map((p) => p.id)).toEqual(["sale", "fresh"]);
    expect(productsByIds(["star", "nope", "sale"], products).map((p) => p.id)).toEqual(["star", "sale"]);
  });
});

describe("catalog filters in the URL", () => {
  it("round-trips through the query and leaves defaults out", () => {
    const filters = { search: "tee", sort: "price-desc" as const, availableOnly: true, sizes: ["S", "M"], priceMin: 50_000, priceMax: 200_000 };
    const query = catalogFiltersQuery(filters);
    expect(query).toBe("q=tee&sort=price-desc&available=1&size=S%2CM&min=50000&max=200000");
    expect(parseCatalogFilters(new URLSearchParams(query))).toEqual(filters);
    expect(catalogFiltersQuery(EMPTY_FILTERS)).toBe("");
    expect(isBrowsing(EMPTY_FILTERS)).toBe(true);
    expect(isBrowsing({ ...EMPTY_FILTERS, sizes: ["M"] })).toBe(false);
  });

  it("ignores bad values", () => {
    expect(parseCatalogFilters(new URLSearchParams("sort=weird&min=-5&max=abc&size=,,"))).toEqual(EMPTY_FILTERS);
  });

  it("filters by size and starting price on top of search, availability and sort", () => {
    expect(catalogSizes(products)).toEqual(["S", "M"]);
    expect(applyCatalogFilters(products, { ...EMPTY_FILTERS, sizes: ["M"] }).map((p) => p.id)).toEqual(["shirt"]);
    expect(applyCatalogFilters(products, { ...EMPTY_FILTERS, priceMin: 60_000, priceMax: 160_000 }).map((p) => p.id)).toEqual(["sale", "shirt"]);
    expect(applyCatalogFilters(products, { ...EMPTY_FILTERS, priceMax: 100_000, sort: "price-asc" }).map((p) => p.id)).toEqual(["fresh", "sale"]);
    expect(applyCatalogFilters(products, { ...EMPTY_FILTERS, search: "cap", sizes: ["M"] })).toEqual([]);
  });
});

describe("saleEndsText", () => {
  const format = (value: string) => `on ${value.slice(0, 10)}`;
  it("names the end date, falls back to an open-ended label and hides without a sale", () => {
    expect(saleEndsText(sale, format)).toBe("Sale ends on 2026-10-20");
    expect(saleEndsText({ salePercent: 10, saleUntil: null }, format)).toBe("On sale");
    expect(saleEndsText(fresh, format)).toBeNull();
  });
});
